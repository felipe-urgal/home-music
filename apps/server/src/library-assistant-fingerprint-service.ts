import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantEvidence,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReasonCode,
  type LibraryAssistantSuggestion
} from '@home-music/shared/library-assistant';
import { lookupAcoustIdFingerprint, type AcoustIdFingerprintCandidate } from './acoustid-fingerprint-lookup.js';
import { fingerprintAudioFile, type AudioFingerprint } from './audio-fingerprint.js';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import type { LibraryAssistantStore } from './library-assistant-store.js';

const MIN_ACOUSTID_SCORE = 0.75;
const HIGH_ACOUSTID_SCORE = 0.95;
const AMBIGUOUS_SCORE_MARGIN = 0.03;
const MAX_RUN_SUGGESTIONS = 4;

const METADATA_FIELDS: readonly LibraryAssistantMetadataField[] = ['title', 'artist', 'album', 'albumArtist'];

type FingerprintLibrary = {
  listTracks: () => Track[];
  revision: () => number;
  root: () => string;
  resolveTrackFile: (trackId: string) => string | null;
};

type FingerprintServiceOptions = {
  store: LibraryAssistantStore;
  providers: LibraryAssistantProviderGateway;
  queue: HeavyWorkQueue;
  library: FingerprintLibrary;
  fpcalcCommand?: string;
  acoustIdEnabled?: boolean;
  acoustIdApiKey?: string;
  fingerprint?: (filePath: string, options: { command?: string; signal?: AbortSignal }) => Promise<AudioFingerprint>;
  lookup?: typeof lookupAcoustIdFingerprint;
  now?: () => Date;
  createId?: () => string;
};

type IdentifiedRecording = {
  candidate: AcoustIdFingerprintCandidate;
  recording: AcoustIdFingerprintCandidate['recordings'][number];
};

export type LibraryAssistantFingerprintResult = {
  fingerprintGenerated: boolean;
  externalLookup: boolean;
  identified: boolean;
  acoustIdEnabled: boolean;
  runId: string | null;
  suggestionIds: string[];
  recordingId: string | null;
  conflict: boolean;
  ambiguous: boolean;
};

function exactValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedValue(value: string) {
  return exactValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US');
}

function textEvidence(field: LibraryAssistantMetadataField, sourceValue: string, candidateValue: string) {
  const sourceExact = exactValue(sourceValue);
  const candidateExact = exactValue(candidateValue);
  const match = sourceExact === candidateExact
    ? 'exact'
    : normalizedValue(sourceExact) === normalizedValue(candidateExact)
      ? 'normalized'
      : 'different';
  return {
    type: 'text-match' as const,
    version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
    field,
    match,
    sourceValue,
    candidateValue
  };
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

function ensureConfinedFile(root: string, filePath: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!resolvedRoot || !resolvedFile || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Arquivo da faixa está fora da biblioteca configurada.');
  }
  return resolvedFile;
}

function valuesFor(track: Track, identified: IdentifiedRecording) {
  const recording = identified.recording;
  return {
    title: recording.title,
    artist: recording.artist,
    album: recording.releaseGroupTitle,
    albumArtist: recording.artist
  } satisfies Record<LibraryAssistantMetadataField, string | null>;
}

export class LibraryAssistantFingerprintService {
  private readonly fingerprint: NonNullable<FingerprintServiceOptions['fingerprint']>;
  private readonly lookup: typeof lookupAcoustIdFingerprint;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: FingerprintServiceOptions) {
    this.fingerprint = options.fingerprint ?? ((filePath, request) => fingerprintAudioFile(filePath, request));
    this.lookup = options.lookup ?? lookupAcoustIdFingerprint;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  status() {
    const acoustIdEnabled = optionsBoolean(this.options.acoustIdEnabled);
    return {
      localFingerprint: true,
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
    const filePath = ensureConfinedFile(root, rawFilePath);
    const initialRevision = this.options.library.revision();
    const acoustIdEnabled = optionsBoolean(this.options.acoustIdEnabled);
    const apiKey = this.options.acoustIdApiKey?.trim() ?? '';
    if (acoustIdEnabled && !apiKey) {
      throw new Error('AcoustID foi habilitado, mas HOME_MUSIC_ACOUSTID_API_KEY não está configurado.');
    }

    return this.options.queue.run(async signal => {
      const local = await this.fingerprint(filePath, {
        command: this.options.fpcalcCommand,
        signal
      });
      if (this.options.library.revision() !== initialRevision) {
        throw new RangeError('A biblioteca mudou durante o fingerprint. Atualize a revisão antes de tentar novamente.');
      }
      if (!acoustIdEnabled) {
        return {
          fingerprintGenerated: true,
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

      const candidates = await this.lookup(this.options.providers, {
        apiKey,
        durationSeconds: local.durationSeconds,
        fingerprint: local.fingerprint,
        signal
      });
      if (this.options.library.revision() !== initialRevision) {
        throw new RangeError('A biblioteca mudou durante a identificação. Atualize a revisão antes de tentar novamente.');
      }
      const { best, ambiguous } = chooseRecording(candidates);
      if (!best) {
        return {
          fingerprintGenerated: true,
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
      const conflict = previousRecordingIds.size > 0 && !previousRecordingIds.has(best.recording.recordingId);
      const reasonCodes = new Set<LibraryAssistantReasonCode>(['provider-match', 'strong-external-id']);
      if (ambiguous) reasonCodes.add('ambiguous-candidates');
      if (conflict) {
        reasonCodes.add('source-conflict');
        reasonCodes.add('metadata-conflict');
      }
      if (sourceSuggestion.reasonCodes.includes('human-override')) reasonCodes.add('human-override');
      const confidence = conflict || ambiguous
        ? 'low'
        : best.candidate.score >= HIGH_ACOUSTID_SCORE
          ? 'high'
          : 'medium';
      const commonEvidence: LibraryAssistantEvidence[] = [
        {
          type: 'external-id',
          version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
          source: 'acoustid',
          id: best.candidate.acoustId
        },
        {
          type: 'external-id',
          version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
          source: 'musicbrainz',
          kind: 'recording',
          id: best.recording.recordingId
        }
      ];
      if (best.recording.artistId) commonEvidence.push({
        type: 'external-id',
        version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
        source: 'musicbrainz',
        kind: 'artist',
        id: best.recording.artistId
      });
      if (best.recording.releaseGroupId) commonEvidence.push({
        type: 'external-id',
        version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
        source: 'musicbrainz',
        kind: 'release-group',
        id: best.recording.releaseGroupId
      });

      const values = valuesFor(track, best);
      const createdAt = this.now().toISOString();
      const fingerprintRunId = `assistant-fingerprint-${this.createId()}`;
      const suggestions = METADATA_FIELDS.flatMap(field => {
        const suggestedValue = values[field]?.trim();
        if (!suggestedValue || exactValue(track[field]) === exactValue(suggestedValue)) return [];
        const evidence: LibraryAssistantEvidence[] = [
          ...commonEvidence,
          textEvidence(field, track[field], suggestedValue)
        ];
        if (conflict) evidence.push({
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

function optionsBoolean(value: boolean | undefined) {
  return value === true;
}
