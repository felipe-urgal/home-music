import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LibraryAssistantMetadataField } from '@home-music/shared/library-assistant';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryRouteProjection } from './library-routes.js';
import type { LibraryService } from './library-service.js';
import { createLrclibLyricsAnalyzer, resolveLrclibLyricsCandidate } from './lrclib-lyrics-analyzer.js';
import { readSidecarLyrics } from './lyrics.js';
import {
  createMusicBrainzMetadataAnalyzer,
  needsMusicBrainzEnrichment
} from './musicbrainz-metadata-analyzer.js';
import { LibraryAssistantCompositeReviewService } from './library-assistant-composite-review-service.js';
import { LibraryAssistantIncrementalIndex } from './library-assistant-incremental-index.js';
import { LibraryAssistantPersistentQueue } from './library-assistant-persistent-queue.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { registerLibraryAssistantReviewRoutes } from './library-assistant-review-routes.js';
import { LibraryAssistantReviewService } from './library-assistant-review-service.js';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import { LibraryAssistantRunMetrics } from './library-assistant-run-metrics.js';
import { LibraryAssistantService, type LibraryAssistantAnalyzer } from './library-assistant-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
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

export function registerLibraryAssistant(
  app: FastifyInstance,
  options: LibraryAssistantBootstrapOptions
) {
  const store = new LibraryAssistantStore(options.databasePath);
  const metrics = new LibraryAssistantRunMetrics();
  const workQueue = new LibraryAssistantPersistentQueue(options.databasePath, {
    onRetry: (item, error) => metrics.recordRetry(item.runId, error.code)
  });
  const incrementalIndex = new LibraryAssistantIncrementalIndex(options.databasePath);
  const metadataOverrides = new TrackMetadataOverrideStore(options.databasePath);
  const coverOverrides = new TrackCoverOverrideStore(options.databasePath);
  const lyricsOverrides = new TrackLyricsOverrideStore(options.databasePath);
  setActiveTrackLyricsOverrideStore(lyricsOverrides);
  const providers = new LibraryAssistantProviderGateway(store, {
    onObservation: observation => metrics.observeProvider(observation)
  });
  const musicBrainzFetch = createMusicBrainzSimpleSearchFetch();
  let assistantReviewRevision = 0;
  const projectRevision = options.projection.projectRevision;

  // registerLibraryAssistant roda antes de registerLibraryRoutes. Compor a revisão
  // aqui garante que apply do Assistente invalide ETag/cache da biblioteca sem rescan.
  options.projection.projectRevision = revision => projectRevision(revision) + assistantReviewRevision;

  const listProjectedTracks = () => options.projection.projectTracks(options.library.listPublicTracks());
  const analysisLibrary = {
    listTracks: listProjectedTracks,
    // A revisão do próprio Assistente atualiza a projeção pública, mas não invalida
    // o run que originou a sugestão. Mudanças externas continuam entrando em
    // projectRevision e, portanto, mantêm a stale protection da análise.
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
  const lyricsAnalyzer = createLrclibLyricsAnalyzer({
    hasEffectiveLyrics: async trackId => Boolean(lyricsOverrides.get(trackId)) || await hasSidecarLyrics(trackId)
  });
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
    resolveLyricsCandidate: candidateId => resolveLrclibLyricsCandidate(providers, candidateId),
    onLyricsChanged: () => { assistantReviewRevision += 1; }
  });

  registerLibraryAssistantRoutes(app, service, workQueue, metrics);
  registerLibraryAssistantReviewRoutes(app, review);
  app.addHook('onClose', async () => {
    await service.close();
    review.close();
    setActiveTrackLyricsOverrideStore(null);
    lyricsOverrides.close();
    coverOverrides.close();
    metadataOverrides.close();
    incrementalIndex.close();
    workQueue.close();
    store.close();
  });

  return service;
}
