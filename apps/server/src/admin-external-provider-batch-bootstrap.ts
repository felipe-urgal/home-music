import type { FastifyInstance } from 'fastify';
import type { ExternalProviderImportManager } from './external-provider.js';
import {
  DEFAULT_PROVIDER_BATCH_MAX_DURATION_MINUTES,
  DEFAULT_PROVIDER_BATCH_MAX_ITEMS,
  DEFAULT_PROVIDER_BATCH_MAX_MEGABYTES,
  ExternalProviderBatchManager,
  parseProviderBatchMaxDurationMinutes,
  parseProviderBatchMaxItems,
  parseProviderBatchMaxMegabytes
} from './external-provider-batch.js';
import type { ImportAutomaticFlowManager } from './import-automatic-flow.js';
import type { ImportDuplicateDetectionManager } from './import-duplicate-detection.js';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportMetadataPreviewManager } from './import-metadata-preview.js';
import type { ImportSafeDestinationManager } from './import-safe-destination.js';
import { YtDlpBatchInspector } from './yt-dlp-batch-inspector.js';

function configuredInteger(
  app: FastifyInstance,
  raw: string | undefined,
  fallback: number,
  parser: (value: string | undefined) => number,
  label: string
) {
  try {
    return parser(raw);
  } catch (error) {
    app.log.warn({ err: error, fallback, component: 'provider-batch' }, `${label} inválido; usando o valor padrão.`);
    return fallback;
  }
}

export function createAdminExternalProviderBatchManager(options: {
  app: FastifyInstance;
  queue: ImportJobQueue;
  externalProviders: ExternalProviderImportManager;
  automaticFlow: ImportAutomaticFlowManager;
  safeDestination: ImportSafeDestinationManager;
  metadataPreview: ImportMetadataPreviewManager;
  duplicateDetection: ImportDuplicateDetectionManager;
  ytDlpCommand: string;
}) {
  const maxItems = configuredInteger(
    options.app,
    process.env.HOME_MUSIC_IMPORT_BATCH_MAX_ITEMS,
    DEFAULT_PROVIDER_BATCH_MAX_ITEMS,
    parseProviderBatchMaxItems,
    'Limite de itens do lote'
  );
  const maxMegabytes = configuredInteger(
    options.app,
    process.env.HOME_MUSIC_IMPORT_BATCH_MAX_MB,
    DEFAULT_PROVIDER_BATCH_MAX_MEGABYTES,
    parseProviderBatchMaxMegabytes,
    'Limite de tamanho do lote'
  );
  const maxDurationMinutes = configuredInteger(
    options.app,
    process.env.HOME_MUSIC_IMPORT_BATCH_MAX_DURATION_MINUTES,
    DEFAULT_PROVIDER_BATCH_MAX_DURATION_MINUTES,
    parseProviderBatchMaxDurationMinutes,
    'Limite de duração do lote'
  );

  return new ExternalProviderBatchManager({
    queue: options.queue,
    externalProviders: options.externalProviders,
    automaticFlow: options.automaticFlow,
    safeDestination: options.safeDestination,
    inspectors: [new YtDlpBatchInspector({ commandPath: options.ytDlpCommand, maxItems })],
    maxItems,
    maxBytes: maxMegabytes * 1024 * 1024,
    maxDurationSeconds: maxDurationMinutes * 60,
    afterDiscard: jobId => {
      options.metadataPreview.forget(jobId);
      options.duplicateDetection.forget(jobId);
    },
    logger: {
      info: (context, message) => options.app.log.info(context, message),
      warn: (context, message) => options.app.log.warn(context, message)
    }
  });
}
