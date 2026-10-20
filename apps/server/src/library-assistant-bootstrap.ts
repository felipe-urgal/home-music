import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Track } from '@home-music/shared';
import type { LibraryAssistantMetadataField } from '@home-music/shared/library-assistant';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryRouteProjection } from './library-routes.js';
import type { LibraryService } from './library-service.js';
import { createLrclibLyricsAnalyzer, resolveLrclibLyricsCandidate } from './lrclib-lyrics-analyzer.js';
import { readSidecarLyrics, readTrackLyrics } from './lyrics.js';
import { createMusicBrainzAlbumArtworkAnalyzer } from './musicbrainz-artwork-analyzer.js';
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
import { closeAll } from './close-resources.js';
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
import { registerMissingCoverFillRoutes } from './missing-cover-fill-routes.js';
import {
  createGeneratedCoverOverrideDetector,
  MissingCoverFillService
} from './missing-cover-fill-service.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import { registerTrackArtworkSearchRoutes } from './track-artwork-search-routes.js';
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
  onProviderGatewayReady?: (providers: LibraryAssistantProviderGateway) => void;
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
  // Install the hook before opening SQLite, so partial construction is also owned.
  const cleanup = new Map<number, () => void | Promise<void>>();
  const own = <T extends { close(): void | Promise<void> }>(order: number, resource: T): T => {
    cleanup.set(order, () => resource.close());
    return resource;
  };
  let closing: Promise<void> | null = null;
  const closeOwned = () => {
    closing ??= closeAll([...cleanup.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, close]) => close));
    return closing;
  };
  app.addHook('onClose', closeOwned);

  try {
    const store = own(160, new LibraryAssistantStore(options.databasePath));
    const fingerprintCache = own(150, new LibraryAssistantFingerprintCache(options.databasePath));
    const reviewPolicy = own(60, new LibraryAssistantReviewPolicyStore(options.databasePath));
    const autonomyStore = own(70, new LibraryAssistantAutonomyStore(options.databasePath));
    const metrics = new LibraryAssistantRunMetrics();
    const workQueue = own(140, new LibraryAssistantPersistentQueue(options.databasePath, {
      onRetry: (item, error) => metrics.recordRetry(item.runId, error.code)
    }));
    const incrementalIndex = own(130, new LibraryAssistantIncrementalIndex(options.databasePath));
    const metadataOverrides = own(120, new TrackMetadataOverrideStore(options.databasePath));
    const coverOverrides = own(110, new TrackCoverOverrideStore(options.databasePath));
    const isGeneratedCover = createGeneratedCoverOverrideDetector();
    const lyricsOverrides = own(100, new TrackLyricsOverrideStore(options.databasePath));
    const localLyricsCandidates = own(90, new LocalLyricsCandidateStore(options.databasePath));
    cleanup.set(80, () => setActiveTrackLyricsOverrideStore(null));
    setActiveTrackLyricsOverrideStore(lyricsOverrides);
    const providers = new LibraryAssistantProviderGateway(store, {
      onObservation: observation => metrics.observeProvider(observation)
    });
    options.onProviderGatewayReady?.(providers);
    const musicBrainzFetch = createMusicBrainzSimpleSearchFetch();
    let assistantReviewRevision = 0;
    const projectRevision = options.projection.projectRevision;
    const fingerprint = fingerprintConfig(options);

    options.projection.projectRevision = revision => projectRevision(revision) + assistantReviewRevision;
    const enhancedRevision = options.projection.projectRevision;
    cleanup.set(85, () => {
      if (options.projection.projectRevision === enhancedRevision) options.projection.projectRevision = projectRevision;
    });

    const listProjectedTracks = () => options.projection.projectTracks(options.library.listPublicTracks());
    const listCoverFillTracks = () => {
      const projectedPublicTracks = listProjectedTracks();
      const publicTrackIds = new Set(projectedPublicTracks.map(track => track.id));
      metadataOverrides.refresh();
      coverOverrides.refresh();
      const inactiveTracks = options.library.listAdminTracks()
        .filter(track => !publicTrackIds.has(track.id))
        .map(({ enabled: _enabled, ...track }) =>
          coverOverrides.resolveTrack(metadataOverrides.resolveTrack(track))
        );
      return [...projectedPublicTracks, ...inactiveTracks];
    };
    const listAnalysisTracks = () => listCoverFillTracks().map((track: Track) => {
      const cover = coverOverrides.getStatus(track.id);
      if (
        !cover
        || cover.physicalHasCover
        || !cover.override
        || !isGeneratedCover(track, cover.override.version)
      ) return track;

      // A capa gerada é apenas um fallback visual. Para a Assistente ela continua
      // sendo artwork ausente e pode ser substituída por uma capa externa confiável.
      return {
        ...track,
        hasCover: false,
        coverVersion: undefined
      };
    });
    const analysisLibrary = {
      listTracks: listAnalysisTracks,
      revision: () => projectRevision(options.library.status().revision)
    };
    const projectedLibrary = {
      listTracks: listCoverFillTracks,
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
      includeArtwork: false,
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
    const metadataFieldAnalyzers = METADATA_FIELDS.map(field => ({
      id: `${metadataAnalyzer.id}-${field}`,
      capability: 'metadata' as const,
      metadataFields: [field] as const,
      async analyze(context) {
        const drafts = await metadataAnalyzer.analyze(context);
        return drafts.filter(draft => (
          draft.target.capability === 'metadata' && draft.target.field === field
        ));
      }
    } satisfies LibraryAssistantAnalyzer));
    const albumArtworkAnalyzer = createMusicBrainzAlbumArtworkAnalyzer({
      fetchImpl: musicBrainzFetch
    });
    const artworkFallbackAnalyzer = createMusicBrainzMetadataAnalyzer({
      fetchImpl: musicBrainzFetch,
      getFileContext(trackId) {
        const indexed = options.library.getTrack(trackId);
        if (!indexed) return null;
        return {
          fileName: path.basename(indexed.filePath),
          folderName: indexed.folder || null
        };
      }
    });
    const artworkAnalyzer = {
      id: `${albumArtworkAnalyzer.id}-with-track-fallback`,
      capability: 'artwork' as const,
      async analyze(context) {
        const albumDrafts = await albumArtworkAnalyzer.analyze(context);
        const resolvedTrackIds = new Set(
          albumDrafts.flatMap(draft =>
            draft.target.capability === 'artwork' ? [draft.target.trackId] : []
          )
        );
        const remainingTracks = context.tracks.filter(track => !resolvedTrackIds.has(track.id));
        if (remainingTracks.length === 0) return albumDrafts;

        const fallbackDrafts = await artworkFallbackAnalyzer.analyze({
          ...context,
          tracks: remainingTracks
        });
        return [
          ...albumDrafts,
          ...fallbackDrafts.filter(draft => draft.capability === 'artwork')
        ];
      }
    } satisfies LibraryAssistantAnalyzer;
    const lyricsAnalyzer = {
      ...createLrclibLyricsAnalyzer({
        hasEffectiveLyrics: async trackId => Boolean(lyricsOverrides.get(trackId)) || await hasSidecarLyrics(trackId)
      }),
      capability: 'lyrics' as const
    } satisfies LibraryAssistantAnalyzer;
    const analyzers = (
      options.analyzers
      ?? [metadataAnalyzer, ...metadataFieldAnalyzers, artworkAnalyzer, lyricsAnalyzer]
    ).map(analyzer => instrumentAnalyzer(analyzer, metrics));
    const service = own(40, new LibraryAssistantService({
      store,
      workQueue,
      incrementalIndex,
      queue: options.queue,
      observability: options.observability,
      providers,
      analyzers,
      library: analysisLibrary,
      isTrackEligible: (capability, track) => (
        capability === 'metadata'
          ? needsMusicBrainzEnrichment(track)
          : capability === 'artwork'
            ? !track.hasCover
            : true
      )
    }));
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
    const localLyrics = own(20, new LocalLyricsWhisperService({
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
    }));
    const baseReview = own(50, new LibraryAssistantReviewService({
      databasePath: options.databasePath,
      store,
      metadataOverrides,
      coverOverrides,
      library: projectedLibrary,
      onMetadataChanged: () => { assistantReviewRevision += 1; },
      onArtworkChanged: () => { assistantReviewRevision += 1; }
    }));
    // After successful construction the composite owns and closes baseReview.
    const review = own(50, new LibraryAssistantCompositeReviewService({
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
    }));
    const coverFill = own(10, new MissingCoverFillService({
      library: { listTracks: listCoverFillTracks },
      analyzer: artworkAnalyzer,
      providers,
      coverOverrides,
      onArtworkChanged: () => { assistantReviewRevision += 1; }
    }));
    const autonomy = own(30, new LibraryAssistantAutonomyController(autonomyStore, service, review));

    registerLibraryAssistantRoutes(app, service, workQueue, metrics);
    registerTrackArtworkSearchRoutes(app, {
      providers,
      coverOverrides,
      listTracks: listCoverFillTracks,
      resolveTrackFile: trackId => options.library.getTrack(trackId)?.filePath ?? null,
      fetchImpl: musicBrainzFetch,
      onArtworkChanged: () => { assistantReviewRevision += 1; }
    });
    registerMissingCoverFillRoutes(app, coverFill);
    registerLibraryAssistantFingerprintRoutes(app, fingerprints);
    registerLibraryAssistantReviewRoutes(app, review);
    registerLibraryAssistantPolicyRoutes(app, reviewPolicy);
    registerLibraryAssistantAutonomyRoutes(app, autonomy);
    registerLocalLyricsRoutes(app, localLyrics);
    const detachLibraryLifecycle = attachLibraryAssistantAutonomyLifecycle(options.library, autonomy);
    cleanup.set(35, detachLibraryLifecycle);
    autonomy.resume();

    return service;

  } catch (error) {
    // This synchronous registration API cannot await asynchronous closers.
    // Start cleanup immediately; app.close() awaits the same promise.
    void closeOwned().catch(closeError => {
      app.log.error({ err: closeError }, 'Falha ao liberar recursos de inicialização do assistente.');
    });
    throw error;
  }
}
