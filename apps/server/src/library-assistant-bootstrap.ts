import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { LibraryAssistantMetadataField } from '@home-music/shared/library-assistant';
import { sanitizeOperationError } from './admin-operation-history.js';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import { createBatchedLibraryAssistantAnalyzer } from './library-assistant-batched-analyzer.js';
import type { LibraryRouteProjection } from './library-routes.js';
import type { LibraryService } from './library-service.js';
import { createMusicBrainzMetadataAnalyzer } from './musicbrainz-metadata-analyzer.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { registerLibraryAssistantReviewRoutes } from './library-assistant-review-routes.js';
import { LibraryAssistantReviewService } from './library-assistant-review-service.js';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import { LibraryAssistantService, type LibraryAssistantAnalyzer } from './library-assistant-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import type { LongJobObservability } from './long-job-observability.js';
import { createMusicBrainzSimpleSearchFetch } from './musicbrainz-simple-search-fetch.js';
import { createRetryingFetch } from './retrying-fetch.js';
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
const METADATA_BATCH_SIZE = 10;
const MUSICBRAINZ_QUERY_TIMEOUT_MS = 10_000;
const MUSICBRAINZ_FAILURE_BACKOFF_MS = 15_000;
const MUSICBRAINZ_FAILURES_BEFORE_BACKOFF = 3;
const MUSICBRAINZ_MAX_RETRY_PASSES = 2;

export function registerLibraryAssistant(
  app: FastifyInstance,
  options: LibraryAssistantBootstrapOptions
) {
  const store = new LibraryAssistantStore(options.databasePath);
  const metadataOverrides = new TrackMetadataOverrideStore(options.databasePath);
  const providers = new LibraryAssistantProviderGateway(store);
  const musicBrainzFetch = createMusicBrainzSimpleSearchFetch(createRetryingFetch());
  let assistantMetadataRevision = 0;
  const projectRevision = options.projection.projectRevision;

  // registerLibraryAssistant roda antes de registerLibraryRoutes. Compor a revisão
  // aqui garante que apply do Assistente invalide ETag/cache da biblioteca sem rescan.
  options.projection.projectRevision = revision => projectRevision(revision) + assistantMetadataRevision;

  const projectedLibrary = {
    listTracks: () => options.projection.projectTracks(options.library.listPublicTracks()),
    revision: () => options.projection.projectRevision(options.library.status().revision)
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
  const defaultAnalyzers = [createBatchedLibraryAssistantAnalyzer(metadataAnalyzer, {
    batchSize: METADATA_BATCH_SIZE,
    providerTimeoutMs: MUSICBRAINZ_QUERY_TIMEOUT_MS,
    failureBackoffMs: MUSICBRAINZ_FAILURE_BACKOFF_MS,
    failuresBeforeBackoff: MUSICBRAINZ_FAILURES_BEFORE_BACKOFF,
    maxRetryPasses: MUSICBRAINZ_MAX_RETRY_PASSES,
    onProgress(progress) {
      app.log.info({
        event: 'library_assistant.batch_completed',
        analyzerId: progress.analyzerId,
        processedTracks: progress.processedTracks,
        totalTracks: progress.totalTracks,
        deferredTracks: progress.deferredTracks,
        failedTracks: progress.failedTracks,
        retryPass: progress.retryPass,
        batchSize: METADATA_BATCH_SIZE
      }, progress.retryPass > 0
        ? 'Passada de recuperação do Assistente concluída.'
        : 'Lote do Assistente da Biblioteca concluído.');
    },
    onTrackDeferred(attempt) {
      const sanitized = sanitizeOperationError(attempt.error);
      app.log.info({
        event: 'library_assistant.track_deferred',
        analyzerId: attempt.analyzerId,
        trackId: attempt.trackId,
        durationMs: attempt.durationMs,
        attempt: attempt.attempt,
        errorMessage: sanitized.message
      }, 'Falha temporária no provider; faixa adiada para nova tentativa.');
    },
    onCircuitCooldown(cooldown) {
      app.log.warn({
        event: 'library_assistant.provider_cooldown',
        analyzerId: cooldown.analyzerId,
        cooldownMs: cooldown.cooldownMs,
        consecutiveFailures: cooldown.consecutiveFailures,
        deferredTracks: cooldown.deferredTracks,
        retryPass: cooldown.retryPass
      }, 'Provider instável; Assistente aguardará antes de continuar.');
    },
    onTrackFailure(failure) {
      const sanitized = sanitizeOperationError(failure.error);
      app.log.warn({
        event: 'library_assistant.track_failed',
        analyzerId: failure.analyzerId,
        trackId: failure.trackId,
        durationMs: failure.durationMs,
        attempts: failure.attempt,
        errorMessage: sanitized.message,
        errorAction: sanitized.action
      }, 'Faixa não pôde ser analisada após esgotar as tentativas; análise continuará.');
    }
  })];
  const service = new LibraryAssistantService({
    store,
    queue: options.queue,
    observability: options.observability,
    providers,
    analyzers: options.analyzers ?? defaultAnalyzers,
    library: projectedLibrary
  });
  const review = new LibraryAssistantReviewService({
    databasePath: options.databasePath,
    store,
    metadataOverrides,
    library: projectedLibrary,
    onMetadataChanged: () => { assistantMetadataRevision += 1; }
  });

  registerLibraryAssistantRoutes(app, service);
  registerLibraryAssistantReviewRoutes(app, review);
  app.addHook('onClose', async () => {
    await service.close();
    review.close();
    metadataOverrides.close();
    store.close();
  });

  return service;
}
