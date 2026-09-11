import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LibraryAssistantMetadataField } from '@home-music/shared/library-assistant';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryRouteProjection } from './library-routes.js';
import type { LibraryService } from './library-service.js';
import { createLrclibLyricsAnalyzer, resolveLrclibLyricsCandidate } from './lrclib-lyrics-analyzer.js';
import { readSidecarLyrics, readTrackLyrics } from './lyrics.js';
import {
  createMusicBrainzMetadataAnalyzer,
  needsMusicBrainzEnrichment
} from './musicbrainz-metadata-analyzer.js';
import {
  attachLibraryAssistantAutonomyLifecycle,
  LibraryAssistantAutonomyController,
  LibraryAssistantAutonomyStore
} from './library-assistant-autonomy.js';
import { registerLibraryAssistantAutonomyRoutes } from './library-assistant-autonomy-routes.js';
import {
  LibraryAssistantCompositeReviewService,
  type ResolvedManagedLyricsCandidate
} from './library-assistant-composite-review-service.js';
import { LibraryAssistantFingerprintCache } from './library-assistant-fingerprint-cache.js';
import { registerLibraryAssistantFingerprintRoutes } from './library-assistant-fingerprint-routes.js';
import { LibraryAssistantFingerprintService } from './library-assistant-fingerprint-service.js';
import { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import { registerLibraryAssistantPolicyRoutes } from './library-assistant-policy-routes.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { registerLibraryAssistantReviewRoutes } from './library-assistant-review-routes.js';
import { LibraryAssistantReviewPolicyStore } from './library-assistant-review-policy.js';
import { LibraryAssistantReviewService } from './library-assistant-review-service.js';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import { LibraryAssistantRunMetrics } from './library-assistant-run-metrics.js';
import { LibraryAssistantService, type LibraryAssistantAnalyzer } from './library-assistant-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LocalLyricsCandidateStore } from './local-lyrics-candidates.js';
import { registerLocalLyricsRoutes } from './local-lyrics-routes.js';
import { fingerprintEffectiveLyrics, LocalLyricsWhisperService } from './local-lyrics-whisper.js';
import type { LongJobObservability } from './long-job-observability.js';
import { createMusicBrainzSimpleSearchFetch } from './musicbrainz-simple-search-fetch.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import {
  setActiveTrackLyricsOverrideStore,
  TrackLyricsOverrideStore
} from './track-lyrics-overrides.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

type LibraryAssistantBootstrapOptions = {
  databasePath: string;
  library: LibraryService;
  projection: LibraryRouteProjection;
  queue: HeavyWorkQueue;
  observability: LongJobObservability;
  analyzers?: readonly LibraryAssistantAnalyzer[];
  fingerprint?: {
    fpcalcCommand?: string;
    acoustIdEnabled?: boolean;
    acoustIdApiKey?: string;
  };
};

const METADATA_FIELDS: readonly LibraryAssistantMetadataField[] = ['title', 'artist', 'album', 'albumArtist'];

function instrumentAnalyzer(analyzer: LibraryAssistantAnalyzer, metrics: LibraryAssistantRunMetrics): LibraryAssistantAnalyzer {
  return {
    ...analyzer,
    analyze(context) {
      metrics.bindSignal(context.runId, context.signal);
      return analyzer.analyze(context);
    }
  };
}

function fingerprintConfig(options: LibraryAssistantBootstrapOptions) {
  return options.fingerprint ?? {
    fpcalcCommand: process.env.HOME_MUSIC_FPCALC_PATH,
    acoustIdEnabled: process.env.HOME_MUSIC_ACOUSTID_ENABLED === 'true',
    acoustIdApiKey: process.env.HOME_MUSIC_ACOUSTID_API_KEY
  };
}

export function registerLibraryAssistant(
  app: FastifyInstance,
  options: LibraryAssistantBootstrapOptions
) {
  const store = new LibraryAssistantStore(options.databasePath);
  const fingerprintCache = new LibraryAssistantFingerprintCache(options.databasePath);
  const reviewPolicy = new LibraryAssistantReviewPolicyStore(options.databasePath);
  const autonomyStore = new LibraryAssistantAutonomyStore(options.databasePath);
  const metrics = new LibraryAssistantRunMetrics();
  const workQueue = new LibraryAssistantPersistentQueue(options.databasePath, {
    onRetry: (item, error) => metrics.recordRetry(item.runId, error.code)
  });
  const incrementalIndex = new LibraryAssistantIncrementalIndex(options.databasePath);
  const metadataOverrides = new TrackMetadataOverrideStore(options.databasePath);
  const coverOverrides = new TrackCoverOverrideStore(options.databasePath);
  const lyricsOverrides = new TrackLyricsOverrideStore(options.databasePath);
  const localLyricsCandidates = new LocalLyricsCandidateStore(options.databasePath);
  setActiveTrackLyricsOverrideStore(lyricsOverrides);
  const providers = new LibraryAssistantProviderGateway(store, {
    onObservation: observation => metrics.observeProvider(observation)
  });
  const musicBrainzFetch = createMusicBrainzSimpleSearchFetch();
  let assistantReviewRevision = 0;
  const projectRevision = options.projection.projectRevision;
  const fingerprint = fingerprintConfig(options);

  options.projection.projectRevision = revision => projectRevision(revision) + assistantReviewRevision;

  const listProjectedTracks = () => options.projection.projectTracks(options.library.listPublicTracks());
  const analysisLibrary = {
    listTracks: listProjectedTracks,
    revision: () => projectRevision(options.library.status().revision)
  };
  const projectedLibrary = {
    listTracks: listProjectedTracks,
    revision: () => options.projection.projectRevision(options.library.status().revision)
  };
  const hasSidecarLyrics = async (trackId: string) => {
    const indexed = options.library.getTrack(trackId);
    const root = options.library.root;
    if (!indexed || !root) return false;
    return Boolean(await readSidecarLyrics(root, indexed.filePath));
  };
  const readEffectiveLyrics = async (trackId: string) => {
    const indexed = options.library.getTrack(trackId);
    const root = options.library.root;
    if (!indexed || !root) return null;
    return readTrackLyrics(root, indexed.filePath, lyricsOverrides.get(trackId));
  };
  const metadataAnalyzer = createMusicBrainzMetadataAnalyzer({
    fetchImpl: musicBrainzFetch,
    getHumanOverrideFields(trackId) {
      const override = metadataOverrides.get(trackId)?.override;
      if (!override) return [];
      return METADATA_FIELDS.filter(field => override[field] != null);
    },
    getFileContext(trackId) {
      const indexed = options.library.getTrack(trackId);
      if (!indexed) return null;
      return {
        fileName: path.basename(indexed.filePath),
        folderName: indexed.folder || null
      };
    }
  });
  const lyricsAnalyzer = {
    ...createLrclibLyricsAnalyzer({
      hasEffectiveLyrics: async trackId => Boolean(lyricsOverrides.get(trackId)) || await hasSidecarLyrics(trackId)
    }),
    capability: 'lyrics' as const
  } satisfies LibraryAssistantAnalyzer;
  const analyzers = (options.analyzers ?? [metadataAnalyzer, lyricsAnalyzer])
    .map(analyzer => instrumentAnalyzer(analyzer, metrics));
  const service = new LibraryAssistantService({
    store,
    workQueue,
    incrementalIndex,
    queue: options.queue,
    observability: options.observability,
    providers,
    analyzers,
    library: analysisLibrary,
    isTrackEligible: (capability, track) => (
      capability !== 'metadata' || needsMusicBrainzEnrichment(track)
    )
  });
  const fingerprints = new LibraryAssistantFingerprintService({
    store,
    cache: fingerprintCache,
    providers,
    queue: options.queue,
    library: {
      listTracks: listProjectedTracks,
      revision: () => projectRevision(options.library.status().revision),
      root: () => options.library.root,
      resolveTrackFile(trackId) {
        return options.library.getTrack(trackId)?.filePath ?? null;
      }
    },
    fpcalcCommand: fingerprint.fpcalcCommand,
    acoustIdEnabled: fingerprint.acoustIdEnabled,
    acoustIdApiKey: fingerprint.acoustIdApiKey
  });
  const localLyrics = new LocalLyricsWhisperService({
    assistantStore: store,
    candidates: localLyricsCandidates,
    lyricsOverrides,
    queue: options.queue,
    library: {
      listTracks: listProjectedTracks,
      revision: projectedLibrary.revision,
      root: () => options.library.root,
      resolveTrackFile(trackId) {
        return options.library.getTrack(trackId)?.filePath ?? null;
      },
      readEffectiveLyrics
    }
  });
  const baseReview = new LibraryAssistantReviewService({
    databasePath: options.databasePath,
    store,
    metadataOverrides,
    coverOverrides,
    library: projectedLibrary,
    onMetadataChanged: () => { assistantReviewRevision += 1; },
    onArtworkChanged: () => { assistantReviewRevision += 1; }
  });
  const review = new LibraryAssistantCompositeReviewService({
    databasePath: options.databasePath,
    base: baseReview,
    store,
    metadataOverrides,
    lyricsOverrides,
    library: projectedLibrary,
    hasSidecarLyrics,
    effectiveLyricsFingerprint: async trackId => fingerprintEffectiveLyrics(await readEffectiveLyrics(trackId)),
    async resolveLyricsCandidate(candidateId): Promise<ResolvedManagedLyricsCandidate | null> {
      if (candidateId.startsWith('local:')) {
        const candidate = localLyricsCandidates.get(candidateId);
        if (!candidate) return null;
        return {
          candidateId: candidate.id,
          synchronized: candidate.synchronized,
          language: candidate.language,
          text: candidate.text,
          source: candidate.source,
          origin: 'generated',
          provider: candidate.source,
          externalId: `whisper.cpp:${candidate.modelLabel}`,
          preservePrevious: true,
          baseLyricsFingerprint: candidate.baseLyricsFingerprint
        };
      }
      const candidate = await resolveLrclibLyricsCandidate(providers, candidateId);
      if (!candidate) return null;
      return {
        candidateId: candidate.candidateId,
        synchronized: candidate.synchronized,
        language: candidate.language,
        text: candidate.text,
        source: 'lrclib',
        origin: 'external',
        provider: 'lrclib',
        externalId: candidate.candidateId,
        preservePrevious: false,
        baseLyricsFingerprint: null
      };
    },
    discardLyricsCandidate(candidateId) {
      if (candidateId.startsWith('local:')) localLyricsCandidates.delete(candidateId);
    },
    onLyricsChanged: () => { assistantReviewRevision += 1; }
  });
  const autonomy = new LibraryAssistantAutonomyController(autonomyStore, service, review);
  attachLibraryAssistantAutonomyLifecycle(options.library, autonomy);
  autonomy.resume();

  registerLibraryAssistantRoutes(app, service, workQueue, metrics);
  registerLibraryAssistantFingerprintRoutes(app, fingerprints);
  registerLibraryAssistantReviewRoutes(app, review);
  registerLibraryAssistantPolicyRoutes(app, reviewPolicy);
  registerLibraryAssistantAutonomyRoutes(app, autonomy);
  registerLocalLyricsRoutes(app, localLyrics);
  app.addHook('onClose', async () => {
    await localLyrics.close();
    await autonomy.close();
    await service.close();
    review.close();
    reviewPolicy.close();
    autonomyStore.close();
    setActiveTrackLyricsOverrideStore(null);
    localLyricsCandidates.close();
    lyricsOverrides.close();
    coverOverrides.close();
    metadataOverrides.close();
    incrementalIndex.close();
    workQueue.close();
    fingerprintCache.close();
    store.close();
  });

  return service;
}
