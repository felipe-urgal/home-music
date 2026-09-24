import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AdminImportJobsResponse, AdminTrackCoverCandidate, Track } from '@home-music/shared';
import { createAdminExternalProviderBatchManager } from './admin-external-provider-batch-bootstrap.js';
import { registerAdminExternalProviderBatchRoutes } from './admin-external-provider-batch-routes.js';
import { AdminImportService } from './admin-import-service.js';
import type { ImportJobQueue } from './import-job-queue.js';
import {
  ExternalProviderError,
  ExternalProviderImportManager
} from './external-provider.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import { ImportAutomaticFlowManager } from './import-automatic-flow.js';
import { installImportRetryStarter } from './import-retry.js';
import { ImportStagingManager, type PromotedImportFile } from './import-staging.js';
import {
  DEFAULT_IMPORT_STAGING_TTL_HOURS,
  ImportStagingCleanupManager,
  parseImportStagingTtlHours
} from './import-staging-cleanup.js';
import {
  DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES,
  ImportUploadError,
  ImportUploadManager,
  parseImportUploadMaxMegabytes
} from './import-upload.js';
import {
  DEFAULT_IMPORT_URL_MAX_MEGABYTES,
  DEFAULT_IMPORT_URL_MAX_REDIRECTS,
  DEFAULT_IMPORT_URL_TIMEOUT_SECONDS,
  ImportUrlError,
  ImportUrlManager,
  parseImportUrlMaxMegabytes,
  parseImportUrlMaxRedirects,
  parseImportUrlTimeoutSeconds
} from './import-url.js';
import {
  ImportMediaValidationError,
  ImportMediaValidationManager,
  resolveFfprobeCommand
} from './import-media-validation.js';
import {
  ImportMetadataPreviewError,
  ImportMetadataPreviewManager,
  type ImportPromotionReview,
  type ImportProviderMetadataHint
} from './import-metadata-preview.js';
import {
  ImportDuplicateDetectionError,
  ImportDuplicateDetectionManager
} from './import-duplicate-detection.js';
import {
  ImportSafeDestinationError,
  ImportSafeDestinationManager
} from './import-safe-destination.js';
import {
  YT_DLP_COMMAND_CONFIG,
  YT_DLP_PROVIDER_ID,
  YtDlpProvider
} from './yt-dlp-provider.js';
import { YtDlpSearch } from './yt-dlp-search.js';
import { downloadTrustedArtworkImage } from './cover-art-archive.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { findMusicBrainzImportMetadataEnrichment } from './musicbrainz-metadata-analyzer.js';
import { createMusicBrainzSimpleSearchFetch } from './musicbrainz-simple-search-fetch.js';
import {
  CoverOverrideValidationError,
  inspectCoverOverride
} from './track-cover-overrides.js';

const defaultImportStagingPath = fileURLToPath(new URL('../../../data/import-staging/', import.meta.url));
const defaultExternalProviderScratchPath = fileURLToPath(new URL('../../../data/provider-scratch/', import.meta.url));

type RegisterAdminImportRoutesOptions = {
  uploads?: ImportUploadManager;
  urls?: ImportUrlManager;
  externalProviders?: ExternalProviderImportManager;
  mediaValidation?: ImportMediaValidationManager;
  metadataPreview?: ImportMetadataPreviewManager;
  duplicateDetection?: ImportDuplicateDetectionManager;
  safeDestination?: ImportSafeDestinationManager;
  automaticFlow?: ImportAutomaticFlowManager | null;
  stagingCleanup?: ImportStagingCleanupManager | null;
  providerMetadata?: (jobId: string) => ImportProviderMetadataHint | null;
  getProviderGateway?: () => LibraryAssistantProviderGateway | null;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  onPromoted?: (
    file: PromotedImportFile,
    jobId: string,
    review: ImportPromotionReview | null
  ) => Promise<void>;
};

function sendImportError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof ImportUploadError
    || error instanceof ImportUrlError
    || error instanceof ExternalProviderError
    || error instanceof ImportMediaValidationError
    || error instanceof ImportMetadataPreviewError
    || error instanceof ImportDuplicateDetectionError
    || error instanceof ImportSafeDestinationError
    || error instanceof CoverOverrideValidationError
  ) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof Error && error.name === 'ImportUploadCancelledError') {
    return reply.code(409).send({ error: 'Upload cancelado.' });
  }
  throw error;
}

type ImportArtworkApplyBody = Pick<AdminTrackCoverCandidate, 'sourceUrl' | 'thumbnailUrl'>;

function importCandidateUrls(body: ImportArtworkApplyBody | undefined) {
  if (!body || typeof body.sourceUrl !== 'string') return null;
  const sourceUrl = body.sourceUrl.trim();
  const thumbnailUrl = typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : null;
  if (!sourceUrl || sourceUrl.length > 2_048 || (thumbnailUrl && thumbnailUrl.length > 2_048)) return null;
  return thumbnailUrl && thumbnailUrl !== sourceUrl ? [thumbnailUrl, sourceUrl] : [sourceUrl];
}

async function downloadImportArtwork(
  urls: readonly string[],
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>
) {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const downloaded = await downloadTrustedArtworkImage(url, { fetchImpl });
      const inspected = inspectCoverOverride(downloaded.data, downloaded.contentType);
      return { data: downloaded.data, contentType: inspected.contentType };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Não foi possível carregar uma capa válida.');
}

function importTrackForEnrichment(job: ReturnType<ImportJobQueue['get']>): Track | null {
  const preview = job?.metadataPreview;
  if (!job || !preview) return null;

  const effectiveTitle = preview.effective.title?.trim() ?? '';
  const effectiveArtist = preview.effective.artist?.trim() ?? '';
  const providerTitle = preview.provider?.title?.trim() ?? '';
  const providerArtist = preview.provider?.artist?.trim() ?? '';

  // Quando o provider entrega algo como "Djavan - Oceano (Ao Vivo)" mas não
  // separa o artista, mantemos o título combinado para o parser conservador
  // conseguir recuperar artista + faixa sem exigir que o usuário salve antes.
  const artist = effectiveArtist || providerArtist || 'Artista desconhecido';
  const title = effectiveArtist || providerArtist
    ? effectiveTitle || providerTitle
    : providerTitle || effectiveTitle;
  if (!title) return null;

  const album = preview.effective.album?.trim() || preview.provider?.album?.trim() || '';
  const albumArtist = preview.effective.albumArtist?.trim()
    || (artist !== 'Artista desconhecido' ? artist : '');

  return {
    id: job.id,
    title,
    artist,
    album,
    albumArtist,
    folder: '',
    folderPath: '',
    duration: preview.durationSeconds > 0 ? preview.durationSeconds : null,
    format: job.mediaDecision?.output.codec ?? '',
    hasCover: preview.cover.available
  };
}

function createDefaultStagingManager() {
  return new ImportStagingManager({
    stagingRoot: process.env.HOME_MUSIC_IMPORT_STAGING_DIR || defaultImportStagingPath,
    musicDir: process.env.MUSIC_DIR || ''
  });
}

function createDefaultStagingCleanupManager(app: FastifyInstance, staging: ImportStagingManager) {
  let ttlHours = DEFAULT_IMPORT_STAGING_TTL_HOURS;
  try {
    ttlHours = parseImportStagingTtlHours(process.env.HOME_MUSIC_IMPORT_STAGING_TTL_HOURS);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackHours: DEFAULT_IMPORT_STAGING_TTL_HOURS },
      'TTL do staging de importação inválido; usando o valor padrão.'
    );
  }
  return new ImportStagingCleanupManager({
    staging,
    ttlMs: ttlHours * 60 * 60 * 1000,
    logger: {
      info: (context, message) => app.log.info(context, message),
      warn: (context, message) => app.log.warn(context, message)
    }
  });
}

function createDefaultUploadManager(
  app: FastifyInstance,
  queue: ImportJobQueue,
  staging: ImportStagingManager
) {
  let maxMegabytes = DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES;
  try {
    maxMegabytes = parseImportUploadMaxMegabytes(process.env.HOME_MUSIC_IMPORT_UPLOAD_MAX_MB);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackMegabytes: DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES },
      'Limite de upload de importação inválido; usando o valor padrão.'
    );
  }

  return new ImportUploadManager({
    queue,
    staging,
    maxBytes: maxMegabytes * 1024 * 1024
  });
}

function createDefaultUrlManager(
  app: FastifyInstance,
  queue: ImportJobQueue,
  staging: ImportStagingManager
) {
  let maxMegabytes = DEFAULT_IMPORT_URL_MAX_MEGABYTES;
  let timeoutSeconds = DEFAULT_IMPORT_URL_TIMEOUT_SECONDS;
  let maxRedirects = DEFAULT_IMPORT_URL_MAX_REDIRECTS;

  try {
    maxMegabytes = parseImportUrlMaxMegabytes(process.env.HOME_MUSIC_IMPORT_URL_MAX_MB);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackMegabytes: DEFAULT_IMPORT_URL_MAX_MEGABYTES },
      'Limite da importação por URL inválido; usando o valor padrão.'
    );
  }
  try {
    timeoutSeconds = parseImportUrlTimeoutSeconds(process.env.HOME_MUSIC_IMPORT_URL_TIMEOUT_SECONDS);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackSeconds: DEFAULT_IMPORT_URL_TIMEOUT_SECONDS },
      'Timeout da importação por URL inválido; usando o valor padrão.'
    );
  }
  try {
    maxRedirects = parseImportUrlMaxRedirects(process.env.HOME_MUSIC_IMPORT_URL_MAX_REDIRECTS);
  } catch (error) {
    app.log.warn(
      { err: error, fallbackRedirects: DEFAULT_IMPORT_URL_MAX_REDIRECTS },
      'Limite de redirects da importação por URL inválido; usando o valor padrão.'
    );
  }

  return new ImportUrlManager({
    queue,
    staging,
    maxBytes: maxMegabytes * 1024 * 1024,
    timeoutMs: timeoutSeconds * 1000,
    maxRedirects
  });
}

function executablePath(candidate: string | undefined) {
  const clean = candidate?.trim() ?? '';
  if (!clean || !path.isAbsolute(clean) || clean.includes('\0')) return '';
  try {
    accessSync(clean, constants.X_OK);
    if (!statSync(clean).isFile()) return '';
    return path.normalize(clean);
  } catch {
    return '';
  }
}

function resolveYtDlpCommand(app: FastifyInstance) {
  const configured = process.env.HOME_MUSIC_YT_DLP_PATH?.trim()
    || process.env.HOME_MUSIC_YTDLP_PATH?.trim()
    || '';
  if (configured) {
    const resolved = executablePath(configured);
    if (!resolved) {
      app.log.warn(
        { component: 'yt-dlp-provider' },
        'HOME_MUSIC_YT_DLP_PATH não aponta para um executável absoluto acessível; provider externo ficará desativado.'
      );
    }
    return resolved;
  }

  const candidates = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    process.env.HOME ? path.join(process.env.HOME, '.local/bin/yt-dlp') : ''
  ];
  for (const candidate of candidates) {
    const resolved = executablePath(candidate);
    if (resolved) return resolved;
  }
  return '';
}

function createDefaultExternalProviderManager(
  queue: ImportJobQueue,
  staging: ImportStagingManager,
  ytDlpCommand: string
) {
  return new ExternalProviderImportManager({
    queue,
    staging,
    scratch: new ExternalProviderScratchManager({
      scratchRoot: process.env.HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR || defaultExternalProviderScratchPath,
      musicDir: process.env.MUSIC_DIR || ''
    }),
    providers: [new YtDlpProvider()],
    providerConfigs: {
      [YT_DLP_PROVIDER_ID]: {
        [YT_DLP_COMMAND_CONFIG]: ytDlpCommand
      }
    }
  });
}

function createDefaultMediaValidationManager(
  queue: ImportJobQueue,
  staging: ImportStagingManager
) {
  const ffmpegCommand = process.env.HOME_MUSIC_FFMPEG_PATH?.trim() || 'ffmpeg';
  const ffprobeCommand = resolveFfprobeCommand(
    process.env.HOME_MUSIC_FFPROBE_PATH,
    process.env.HOME_MUSIC_FFMPEG_PATH
  );
  return new ImportMediaValidationManager({
    queue,
    staging,
    ffmpegCommand,
    ffprobeCommand
  });
}

export function registerAdminImportRoutes(
  app: FastifyInstance,
  queue: ImportJobQueue,
  options: RegisterAdminImportRoutesOptions = {}
) {
  let defaultStaging: ImportStagingManager | null = null;
  const staging = () => {
    defaultStaging ??= createDefaultStagingManager();
    return defaultStaging;
  };
  const uploads = options.uploads ?? createDefaultUploadManager(app, queue, staging());
  const urls = options.urls ?? createDefaultUrlManager(app, queue, staging());
  const ytDlpCommand = resolveYtDlpCommand(app);
  const externalProviders = options.externalProviders
    ?? createDefaultExternalProviderManager(
      queue,
      staging(),
      ytDlpCommand
    );
  const mediaValidation = options.mediaValidation ?? createDefaultMediaValidationManager(queue, staging());
  const providerMetadata = options.providerMetadata ?? ((jobId: string) => {
    const metadata = externalProviders.getPrepared(jobId)?.metadata;
    if (!metadata) return null;
    return {
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album
    };
  });
  const metadataPreview = options.metadataPreview ?? new ImportMetadataPreviewManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    providerMetadata
  });
  const duplicateDetection = options.duplicateDetection ?? new ImportDuplicateDetectionManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId)
  });
  const safeDestination = options.safeDestination ?? new ImportSafeDestinationManager({
    queue,
    staging: staging(),
    validatedLookup: jobId => mediaValidation.getValidated(jobId),
    duplicateReady: jobId => duplicateDetection.isReady(jobId),
    afterPromote: options.onPromoted
      ? (file, jobId) => options.onPromoted!(file, jobId, metadataPreview.getPromotionReview(jobId))
      : undefined
  });
  const automaticFlow = options.automaticFlow === undefined
    ? new ImportAutomaticFlowManager({
        queue,
        mediaValidation,
        metadataPreview,
        duplicateDetection,
        safeDestination,
        logger: {
          info: (context, message) => app.log.info(context, message),
          warn: (context, message) => app.log.warn(context, message)
        }
      })
    : options.automaticFlow;
  const stagingCleanup = options.stagingCleanup !== undefined
    ? options.stagingCleanup
    : process.env.MUSIC_DIR?.trim()
      ? createDefaultStagingCleanupManager(app, staging())
      : null;

  const ytDlpAvailable = Boolean(
    automaticFlow
    && ytDlpCommand
    && externalProviders.listProviders().some(provider => provider.id === YT_DLP_PROVIDER_ID && provider.configured)
  );
  const providerSearch = ytDlpCommand
    ? new YtDlpSearch({ commandPath: ytDlpCommand, maxResults: 10 })
    : null;
  const providerBatches = ytDlpAvailable && automaticFlow
    ? createAdminExternalProviderBatchManager({
        app,
        queue,
        externalProviders,
        automaticFlow,
        safeDestination,
        metadataPreview,
        duplicateDetection,
        ytDlpCommand
      })
    : null;

  if (providerBatches) {
    registerAdminExternalProviderBatchRoutes(app, { batches: providerBatches });
  }
  const imports = new AdminImportService({
    queue,
    uploads,
    urls,
    externalProviders,
    mediaValidation,
    metadataPreview,
    duplicateDetection,
    safeDestination,
    automaticFlow,
    logger: {
      warn: (context, message) => app.log.warn(context, message)
    }
  });

  installImportRetryStarter(app, (context, input) => imports.startRetry(context, input));

  if (stagingCleanup) {
    app.addHook('onReady', async () => {
      try {
        await stagingCleanup.start();
      } catch (error) {
        app.log.warn(
          { err: error, component: 'import-staging-cleanup', reason: 'startup' },
          'Falha na varredura inicial do staging de importações.'
        );
      }
    });
    app.addHook('onClose', async () => {
      stagingCleanup.stop();
    });
  }
  if (automaticFlow) {
    app.addHook('onClose', async () => {
      automaticFlow.stop();
    });
  }

  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
      done(null, payload);
    });
  }

  app.get('/api/admin/imports', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const response: AdminImportJobsResponse & {
      upload: typeof imports.uploadConfig;
      url: typeof imports.urlConfig;
      mediaValidation: typeof imports.mediaValidationConfig;
      providers: ReturnType<AdminImportService['listProviders']>;
    } = {
      jobs: imports.listJobs(),
      upload: imports.uploadConfig,
      url: imports.urlConfig,
      mediaValidation: imports.mediaValidationConfig,
      providers: imports.listProviders()
    };
    return response;
  });

  app.post<{ Body: { fileName?: unknown; size?: unknown; automatic?: unknown } }>(
    '/api/admin/imports/uploads',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(201).send(
          await imports.startUpload(request.body?.fileName, request.body?.size, request.body?.automatic)
        );
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.put<{ Params: { id: string }; Body: Readable }>(
    '/api/admin/imports/uploads/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const contentLengthValue = request.headers['content-length'];
      const contentLength = typeof contentLengthValue === 'string' && /^\d+$/.test(contentLengthValue)
        ? Number(contentLengthValue)
        : undefined;
      try {
        return await imports.receiveUpload(request.params.id, request.body, contentLength);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/uploads/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.cancelUpload(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Body: { url?: unknown; automatic?: unknown } }>(
    '/api/admin/imports/urls',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(202).send(await imports.startUrl(request.body?.url, request.body?.automatic));
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/urls/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.cancelUrl(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { providerId: string }; Body: { query?: unknown } }>(
    '/api/admin/imports/providers/:providerId/search',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (request.params.providerId !== YT_DLP_PROVIDER_ID || !providerSearch) {
        return reply.code(503).send({ error: 'A busca no YouTube / YouTube Music não está disponível no servidor.' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new ExternalProviderError(
          'provider_timeout',
          'A busca no provider externo excedeu o tempo limite.',
          504
        ));
      }, 30_000);
      timeout.unref?.();

      try {
        return await providerSearch.search(request.body?.query, controller.signal);
      } catch (error) {
        return sendImportError(reply, error);
      } finally {
        clearTimeout(timeout);
      }
    }
  );

  app.post<{ Params: { providerId: string }; Body: { url?: unknown; automatic?: unknown } }>(
    '/api/admin/imports/providers/:providerId',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return reply.code(202).send(
          await imports.startExternalProvider(
            request.params.providerId,
            request.body?.url,
            request.body?.automatic
          )
        );
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/imports/providers/jobs/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.cancelExternalProvider(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { profile?: unknown } }>(
    '/api/admin/imports/:id/validate',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.validate(request.params.id, request.body?.profile);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/metadata-preview',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.extractMetadataPreview(request.params.id);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/imports/:id/metadata-preview',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return imports.updateMetadataPreview(request.params.id, request.body);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/metadata-enrichment',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const job = queue.get(request.params.id);
      if (!job) return reply.code(404).send({ error: 'Job de importação não encontrado.' });
      if (job.status !== 'pending' || !job.metadataPreview) {
        return reply.code(409).send({ error: 'Gere o preview antes de buscar sugestões externas.' });
      }

      const track = importTrackForEnrichment(job);
      if (!track) {
        return reply.code(409).send({ error: 'Não há informações suficientes para buscar sugestões externas.' });
      }
      const providers = options.getProviderGateway?.() ?? null;
      if (!providers) {
        return reply.code(503).send({ error: 'Busca externa de metadata ainda não está disponível.' });
      }

      try {
        const enrichment = await findMusicBrainzImportMetadataEnrichment(
          track,
          providers,
          { fetchImpl: createMusicBrainzSimpleSearchFetch(options.fetchImpl) }
        );
        return { enrichment };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível buscar sugestões externas agora.';
        return reply.code(502).send({ error: message });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: ImportArtworkApplyBody }>(
    '/api/admin/imports/:id/metadata-enrichment/cover',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const urls = importCandidateUrls(request.body);
      if (!urls) return reply.code(400).send({ error: 'Capa externa inválida.' });

      try {
        const downloaded = await downloadImportArtwork(urls, options.fetchImpl);
        return metadataPreview.setExternalCover(request.params.id, downloaded);
      } catch (error) {
        if (error instanceof ImportMetadataPreviewError || error instanceof CoverOverrideValidationError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        const message = error instanceof Error ? error.message : 'Não foi possível carregar a capa externa.';
        return reply.code(502).send({ error: message });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/:id/cover',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const cover = imports.getCover(request.params.id);
      if (!cover) return reply.code(404).send({ error: 'Capa do preview não encontrada.' });
      reply.type(cover.contentType);
      return reply.send(cover.data);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      return { check: imports.getDuplicateCheck(request.params.id) };
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { check: await imports.detectDuplicates(request.params.id) };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/imports/:id/duplicates/review',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return { check: imports.reviewDuplicates(request.params.id) };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string }; Querystring: { folderPath?: string } }>(
    '/api/admin/imports/:id/destination',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      try {
        return { destination: await imports.planDestination(request.params.id, request.query.folderPath) };
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { folderPath?: unknown } }>(
    '/api/admin/imports/:id/promote',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        return await imports.promote(request.params.id, request.body?.folderPath);
      } catch (error) {
        return sendImportError(reply, error);
      }
    }
  );
}
