import { createHash, randomUUID } from 'node:crypto';
import type { Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantEvidence,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReasonCode,
  type LibraryAssistantSuggestion
} from '@home-music/shared/library-assistant';
import { lookupAcoustIdFingerprint, type AcoustIdFingerprintCandidate } from './acoustid-fingerprint-lookup.js';
import {
  fingerprintAudioFile,
  probeFpcalc,
  resolveFingerprintFile,
  type AudioFingerprint,
  type FingerprintFile
} from './audio-fingerprint.js';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type { LibraryAssistantStore } from './library-assistant-store.js';
import { rankMusicBrainzCandidate } from './musicbrainz-metadata-analyzer.js';

const MIN_ACOUSTID_SCORE = 0.75;
const HIGH_ACOUSTID_SCORE = 0.95;
const AMBIGUOUS_SCORE_MARGIN = 0.03;
const MAX_RUN_SUGGESTIONS = 4;

const METADATA_FIELDS = ['title', 'artist', 'album'] as const satisfies readonly LibraryAssistantMetadataField[];

type FingerprintLibrary = {
  listTracks: () => Track[];
  revision: () => number;
  root: () => string;
  resolveTrackFile: (trackId: string) => string | null;
};

type FingerprintServiceOptions = {
  store: LibraryAssistantStore;
  cache: LibraryAssistantFingerprintCache;
  providers: LibraryAssistantProviderGateway;
  queue: HeavyWorkQueue;
  library: FingerprintLibrary;
  fpcalcCommand?: string;
  acoustIdEnabled?: boolean;
  acoustIdApiKey?: string;
  fingerprint?: (filePath: string, options: { command?: string; signal?: AbortSignal }) => Promise<AudioFingerprint>;
  lookup?: typeof lookupAcoustIdFingerprint;
  probe?: typeof probeFpcalc;
  now?: () => Date;
  createId?: () => string;
};

type IdentifiedRecording = {
  candidate: AcoustIdFingerprintCandidate;
  recording: AcoustIdFingerprintCandidate['recordings'][number];
};

export type LibraryAssistantFingerprintResult = {
  fingerprintGenerated: boolean;
  cacheHit: boolean;
  externalLookup: boolean;
  identified: boolean;
  acoustIdEnabled: boolean;
  runId: string | null;
  suggestionIds: string[];
  recordingId: string | null;
  conflict: boolean;
  ambiguous: boolean;
};

export class LibraryAssistantFingerprintOperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 409 | 503,
    public readonly code: 'fingerprint-input-invalid' | 'fingerprint-unavailable'
  ) {
    super(message);
    this.name = 'LibraryAssistantFingerprintOperationError';
  }
}

function exactValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function metadataPremiseSignature(track: Track, field: LibraryAssistantMetadataField) {
  return createHash('sha256').update(JSON.stringify({
    capability: 'metadata',
    trackId: track.id,
    field,
    value: track[field]
  })).digest('hex');
}

function isOpenDifficultMetadataSuggestion(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability !== 'metadata') return false;
  if (suggestion.status !== 'pending' && suggestion.status !== 'review') return false;
  return suggestion.confidence !== 'high'
    || suggestion.reasonCodes.some(reason => [
      'ambiguous-candidates',
      'metadata-conflict',
      'source-conflict',
      'metadata-missing',
      'human-override'
    ].includes(reason));
}

function sourceRecordingIds(suggestion: LibraryAssistantSuggestion) {
  return new Set(suggestion.evidence.flatMap(item => (
    item.type === 'external-id'
      && item.source === 'musicbrainz'
      && item.kind === 'recording'
      ? [item.id]
      : []
  )));
}

function chooseRecording(candidates: AcoustIdFingerprintCandidate[]) {
  const flattened: IdentifiedRecording[] = [];
  for (const candidate of candidates) {
    if (candidate.score < MIN_ACOUSTID_SCORE) continue;
    for (const recording of candidate.recordings) flattened.push({ candidate, recording });
  }
  flattened.sort((left, right) => (
    right.candidate.score - left.candidate.score
    || left.recording.recordingId.localeCompare(right.recording.recordingId)
  ));
  const best = flattened[0] ?? null;
  if (!best) return { best: null, ambiguous: false };
  const second = flattened.find(item => item.recording.recordingId !== best.recording.recordingId);
  const ambiguous = Boolean(
    second && best.candidate.score - second.candidate.score <= AMBIGUOUS_SCORE_MARGIN
  );
  return { best, ambiguous };
}

function valuesFor(identified: IdentifiedRecording) {
  const recording = identified.recording;
  return {
    title: recording.title,
    artist: recording.artist,
    album: recording.releaseGroupTitle
  } satisfies Record<(typeof METADATA_FIELDS)[number], string | null>;
}

function sameFile(left: { filePath: string; signature: string }, right: { filePath: string; signature: string }) {
  return left.filePath === right.filePath && left.signature === right.signature;
}

async function resolveInputFile(root: string, filePath: string): Promise<FingerprintFile> {
  try {
    return await resolveFingerprintFile(root, filePath);
  } catch (error) {
    throw new LibraryAssistantFingerprintOperationError(
      error instanceof Error ? error.message : 'A faixa não está disponível para fingerprint local.',
      409,
      'fingerprint-input-invalid'
    );
  }
}

function providerFailureMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code || '');
    if (code === 'provider-timeout') return 'AcoustID não respondeu dentro do tempo limite. Tente novamente.';
    if (code === 'provider-rate-limited') return 'AcoustID atingiu o limite de consultas. Tente novamente mais tarde.';
  }
  return 'AcoustID está temporariamente indisponível. Tente novamente mais tarde.';
}

export class LibraryAssistantFingerprintService {
  private readonly fingerprint: NonNullable<FingerprintServiceOptions['fingerprint']>;
  private readonly lookup: typeof lookupAcoustIdFingerprint;
  private readonly probe: typeof probeFpcalc;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: FingerprintServiceOptions) {
    this.fingerprint = options.fingerprint ?? ((filePath, request) => fingerprintAudioFile(filePath, request));
    this.lookup = options.lookup ?? lookupAcoustIdFingerprint;
    this.probe = options.probe ?? probeFpcalc;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async status() {
    const acoustIdEnabled = this.options.acoustIdEnabled === true;
    return {
      fpcalc: await this.probe(this.options.fpcalcCommand),
      acoustIdEnabled,
      acoustIdConfigured: acoustIdEnabled && Boolean(this.options.acoustIdApiKey?.trim())
    };
  }

  async identify(runId: string, suggestionId: string): Promise<LibraryAssistantFingerprintResult | null> {
    const run = this.options.store.getRun(runId);
    if (!run) return null;
    const record = this.options.store.listSuggestionRecords(runId, { limit: 500 })
      .find(item => item.suggestion.id === suggestionId);
    if (!record) return null;
    const sourceSuggestion = record.suggestion;
    if (!isOpenDifficultMetadataSuggestion(sourceSuggestion)) {
      throw new RangeError('Fingerprint só pode ser solicitado para sugestão de metadata ainda aberta e ambígua.');
    }

    const track = this.options.library.listTracks().find(item => item.id === sourceSuggestion.target.trackId);
    const root = this.options.library.root();
    const rawFilePath = this.options.library.resolveTrackFile(sourceSuggestion.target.trackId);
    if (!track || !root || !rawFilePath) throw new RangeError('Faixa não está disponível para fingerprint local.');
    const inputFile = await resolveInputFile(root, rawFilePath);
    const initialRevision = this.options.library.revision();
    const acoustIdEnabled = this.options.acoustIdEnabled === true;
    const apiKey = this.options.acoustIdApiKey?.trim() ?? '';
    if (acoustIdEnabled && !apiKey) {
      throw new LibraryAssistantFingerprintOperationError(
        'AcoustID está habilitado, mas a chave da aplicação não está configurada.',
        503,
        'fingerprint-unavailable'
      );
    }

    return this.options.queue.run(async signal => {
      const queuedRecord = this.options.store.listSuggestionRecords(runId, { limit: 500 })
        .find(item => item.suggestion.id === suggestionId);
      if (!queuedRecord || !isOpenDifficultMetadataSuggestion(queuedRecord.suggestion)) {
        throw new RangeError('A sugestão foi resolvida enquanto aguardava o fingerprint. Atualize a revisão.');
      }
      if (this.options.library.revision() !== initialRevision) {
        throw new RangeError('A biblioteca mudou enquanto o fingerprint aguardava na fila. Atualize a revisão.');
      }

      const cached = this.options.cache.get(track.id, inputFile.signature);
      let local: AudioFingerprint;
      let cacheHit = Boolean(cached);
      if (cached) {
        local = { durationSeconds: cached.durationSeconds, fingerprint: cached.fingerprint };
      } else {
        try {
          local = await this.fingerprint(inputFile.filePath, {
            command: this.options.fpcalcCommand,
            signal
          });
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
          throw new LibraryAssistantFingerprintOperationError(
            error instanceof Error && /^Chromaprint\/fpcalc /.test(error.message)
              ? error.message
              : 'Chromaprint/fpcalc não conseguiu gerar o fingerprint.',
            503,
            'fingerprint-unavailable'
          );
        }
        const afterFingerprint = await resolveInputFile(root, rawFilePath);
        if (!sameFile(inputFile, afterFingerprint)) {
          throw new RangeError('O arquivo mudou durante o fingerprint. Atualize a biblioteca antes de tentar novamente.');
        }
        this.options.cache.put(track.id, {
          signature: inputFile.signature,
          durationSeconds: local.durationSeconds,
          fingerprint: local.fingerprint
        }, this.now().toISOString());
        cacheHit = false;
      }
      if (this.options.library.revision() !== initialRevision) {
        throw new RangeError('A biblioteca mudou durante o fingerprint. Atualize a revisão antes de tentar novamente.');
      }
      if (!acoustIdEnabled) {
        return {
          fingerprintGenerated: true,
          cacheHit,
          externalLookup: false,
          identified: false,
          acoustIdEnabled: false,
          runId: null,
          suggestionIds: [],
          recordingId: null,
          conflict: false,
          ambiguous: false
        };
      }

      let candidates: AcoustIdFingerprintCandidate[];
      try {
        candidates = await this.lookup(this.options.providers, {
          apiKey,
          durationSeconds: local.durationSeconds,
          fingerprint: local.fingerprint,
          signal
        });
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'LibraryAssistantProviderAbortedError')) throw error;
        throw new LibraryAssistantFingerprintOperationError(
          providerFailureMessage(error),
          503,
          'fingerprint-unavailable'
        );
      }
      const finalFile = await resolveInputFile(root, rawFilePath);
      if (!sameFile(inputFile, finalFile) || this.options.library.revision() !== initialRevision) {
        throw new RangeError('A faixa mudou durante a identificação. Atualize a biblioteca antes de tentar novamente.');
      }
      const { best, ambiguous } = chooseRecording(candidates);
      if (!best) {
        return {
          fingerprintGenerated: true,
          cacheHit,
          externalLookup: true,
          identified: false,
          acoustIdEnabled: true,
          runId: null,
          suggestionIds: [],
          recordingId: null,
          conflict: false,
          ambiguous: false
        };
      }

      const previousRecordingIds = sourceRecordingIds(sourceSuggestion);
      const externalConflict = previousRecordingIds.size > 0
        && !previousRecordingIds.has(best.recording.recordingId);
      const matcher = best.recording.title && best.recording.artist
        ? rankMusicBrainzCandidate(track, {
            recordingId: best.recording.recordingId,
            title: best.recording.title,
            artist: best.recording.artist,
            artistId: best.recording.artistId,
            durationSeconds: best.recording.durationSeconds,
            releases: []
          })
        : null;
      const durationConflict = Boolean(matcher?.reasonCodes.includes('duration-mismatch'));
      const matcherConflict = Boolean(matcher?.blockingConflict);
      const conflict = externalConflict || durationConflict || matcherConflict;
      const reasonCodes = new Set<LibraryAssistantReasonCode>([
        ...(matcher?.reasonCodes ?? []),
        'provider-match',
        'strong-external-id'
      ]);
      if (best.candidate.score >= HIGH_ACOUSTID_SCORE) reasonCodes.add('fingerprint.match-strong');
      if (ambiguous) {
        reasonCodes.add('ambiguous-candidates');
        reasonCodes.add('fingerprint.multiple-recordings');
      }
      if (durationConflict) reasonCodes.add('fingerprint.duration-conflict');
      if (externalConflict || matcherConflict) {
        reasonCodes.add('source-conflict');
        reasonCodes.add('fingerprint.external-conflict');
      }
      if (conflict) reasonCodes.add('metadata-conflict');
      if (sourceSuggestion.reasonCodes.includes('human-override')) reasonCodes.add('human-override');
      const confidence: LibraryAssistantSuggestion['confidence'] = conflict || ambiguous
        ? 'low'
        : best.candidate.score >= HIGH_ACOUSTID_SCORE
          ? 'high'
          : 'medium';
      const commonEvidence: LibraryAssistantEvidence[] = [
        ...(matcher?.evidence ?? []),
        {
          type: 'external-id',
          version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
          source: 'acoustid',
          id: best.candidate.acoustId
        }
      ];
      if (best.recording.releaseGroupId && !commonEvidence.some(item => (
        item.type === 'external-id'
        && item.source === 'musicbrainz'
        && item.kind === 'release-group'
        && item.id === best.recording.releaseGroupId
      ))) commonEvidence.push({
        type: 'external-id',
        version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
        source: 'musicbrainz',
        kind: 'release-group',
        id: best.recording.releaseGroupId
      });

      const values = valuesFor(best);
      const createdAt = this.now().toISOString();
      const fingerprintRunId = `assistant-fingerprint-${this.createId()}`;
      const suggestions = METADATA_FIELDS.flatMap(field => {
        const suggestedValue = values[field]?.trim();
        if (!suggestedValue || exactValue(track[field]) === exactValue(suggestedValue)) return [];
        const evidence: LibraryAssistantEvidence[] = [...commonEvidence];
        if (externalConflict || matcherConflict) evidence.push({
          type: 'source-conflict',
          version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
          field,
          sources: ['local', 'acoustid']
        });
        return [{
          id: `suggestion-${this.createId()}`,
          runId: fingerprintRunId,
          capability: 'metadata' as const,
          trackId: track.id,
          status: 'review' as const,
          confidence,
          reasonCodes: [...reasonCodes],
          evidence,
          provenance: {
            source: 'acoustid' as const,
            providerVersion: 'chromaprint-acoustid-v1',
            externalId: best.candidate.acoustId
          },
          target: {
            capability: 'metadata' as const,
            trackId: track.id,
            field,
            currentValue: track[field],
            suggestedValue
          },
          premiseSignature: metadataPremiseSignature(track, field),
          createdAt
        }];
      }).slice(0, MAX_RUN_SUGGESTIONS);

      let persistedRunId: string | null = null;
      if (suggestions.length > 0) {
        this.options.store.createRun({
          id: fingerprintRunId,
          capability: 'metadata',
          libraryRevision: initialRevision,
          createdAt
        });
        this.options.store.startRun(fingerprintRunId, createdAt);
        this.options.store.insertSuggestions(suggestions);
        this.options.store.completeRun(fingerprintRunId, this.now().toISOString());
        persistedRunId = fingerprintRunId;
      }

      return {
        fingerprintGenerated: true,
        cacheHit,
        externalLookup: true,
        identified: true,
        acoustIdEnabled: true,
        runId: persistedRunId,
        suggestionIds: suggestions.map(item => item.id),
        recordingId: best.recording.recordingId,
        conflict,
        ambiguous
      };
    });
  }
}
