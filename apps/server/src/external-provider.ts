import type { FileHandle } from 'node:fs/promises';
import type { ImportJob } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportStagingManager } from './import-staging.js';
import {
  ExternalProviderScratchError,
  type ExternalProviderScratchManager
} from './external-provider-scratch.js';

const MAX_URL_BYTES = 4096;
const MAX_PROVIDER_ID_LENGTH = 64;
const MAX_PROVIDER_LABEL_LENGTH = 120;
const MAX_METADATA_LENGTH = 500;
const READ_BUFFER_BYTES = 64 * 1024;

export type ExternalProviderCapabilities = Readonly<{
  audio: boolean;
  metadata: boolean;
  thumbnail: boolean;
  playlists: boolean;
}>;

export type ExternalProviderRequest = Readonly<{
  url: string;
}>;

export type ExternalProviderConfig = Readonly<Record<string, string>>;

export type ExternalProviderMetadata = Readonly<{
  sourceId: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  thumbnailUrl: string | null;
}>;

export type ExternalProviderPreparedMedia = Readonly<{
  relativePath: string;
  contentType?: string | null;
  metadata?: Partial<ExternalProviderMetadata> | null;
}>;

export type ExternalProviderContext = Readonly<{
  scratchDir: string;
  signal: AbortSignal;
  config: ExternalProviderConfig;
}>;

export interface ExternalProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ExternalProviderCapabilities;
  readonly requiredConfigKeys?: readonly string[];
  validate(request: ExternalProviderRequest): Promise<void> | void;
  prepare(
    request: ExternalProviderRequest,
    context: ExternalProviderContext
  ): Promise<ExternalProviderPreparedMedia>;
}

export type ExternalProviderDescriptor = Readonly<{
  id: string;
  label: string;
  capabilities: ExternalProviderCapabilities;
  configured: boolean;
}>;

export type ExternalProviderPreparedResult = Readonly<{
  jobId: string;
  provider: string;
  metadata: ExternalProviderMetadata;
  payload: Readonly<{
    sizeBytes: number;
    contentType: string | null;
  }>;
}>;

export type ExternalProviderErrorCode =
  | 'invalid_input'
  | 'provider_not_found'
  | 'provider_not_configured'
  | 'provider_timeout'
  | 'provider_cancelled'
  | 'provider_failed'
  | 'provider_network_failed'
  | 'provider_auth_required'
  | 'provider_runtime_missing'
  | 'provider_incompatible'
  | 'invalid_output'
  | 'output_too_large'
  | 'setup_failed';

export class ExternalProviderError extends Error {
  readonly code: ExternalProviderErrorCode;
  readonly statusCode: number;

  constructor(code: ExternalProviderErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = 'ExternalProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

type ExternalProviderManagerOptions = {
  queue: ImportJobQueue;
  staging: ImportStagingManager;
  scratch: ExternalProviderScratchManager;
  providers: readonly ExternalProvider[];
  providerConfigs?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type ProviderSession = {
  controller: AbortController;
  cancelRequested: boolean;
  settled: Promise<void>;
};

function normalizeProviderId(value: string) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!id || id.length > MAX_PROVIDER_ID_LENGTH || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new ExternalProviderError('provider_not_found', 'Provider externo inválido.', 404);
  }
  return id;
}

function normalizeProviderDefinition(provider: ExternalProvider) {
  const id = normalizeProviderId(provider.id);
  const label = provider.label.trim().slice(0, MAX_PROVIDER_LABEL_LENGTH);
  if (!label) throw new Error(`Provider ${id} precisa de um label.`);
  const requiredConfigKeys = [...new Set((provider.requiredConfigKeys ?? []).map(key => key.trim()).filter(Boolean))];
  const capabilities: ExternalProviderCapabilities = Object.freeze({
    audio: Boolean(provider.capabilities.audio),
    metadata: Boolean(provider.capabilities.metadata),
    thumbnail: Boolean(provider.capabilities.thumbnail),
    playlists: Boolean(provider.capabilities.playlists)
  });
  return { provider, id, label, requiredConfigKeys, capabilities };
}

function normalizeRequest(request: ExternalProviderRequest) {
  const raw = typeof request?.url === 'string' ? request.url.trim() : '';
  if (!raw) throw new ExternalProviderError('invalid_input', 'URL do provider é obrigatória.');
  if (Buffer.byteLength(raw, 'utf8') > MAX_URL_BYTES) {
    throw new ExternalProviderError('invalid_input', 'URL do provider excede o limite de tamanho.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExternalProviderError('invalid_input', 'URL do provider é inválida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExternalProviderError('invalid_input', 'Somente URLs HTTP e HTTPS são permitidas.');
  }
  if (url.username || url.password) {
    throw new ExternalProviderError('invalid_input', 'URLs com credenciais embutidas não são permitidas.');
  }
  url.hash = '';
  return Object.freeze({ url: url.toString() }) satisfies ExternalProviderRequest;
}

function cleanMetadataValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().slice(0, MAX_METADATA_LENGTH);
  return clean || null;
}

function sanitizeMetadata(value: Partial<ExternalProviderMetadata> | null | undefined): ExternalProviderMetadata {
  return {
    sourceId: cleanMetadataValue(value?.sourceId),
    title: cleanMetadataValue(value?.title),
    artist: cleanMetadataValue(value?.artist),
    album: cleanMetadataValue(value?.album),
    thumbnailUrl: cleanMetadataValue(value?.thumbnailUrl)
  };
}

function sanitizeContentType(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  if (!clean || clean.length > 120 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(clean)) return null;
  return clean;
}

function configured(requiredKeys: readonly string[], config: ExternalProviderConfig) {
  return requiredKeys.every(key => Boolean(config[key]?.trim()));
}

function canonicalFailure(error: ExternalProviderError) {
  switch (error.code) {
    case 'provider_timeout':
      return new ExternalProviderError('provider_timeout', 'O provider externo excedeu o tempo limite.', 504);
    case 'provider_cancelled':
      return new ExternalProviderError('provider_cancelled', 'Importação do provider cancelada.', 409);
    case 'provider_network_failed':
      return new ExternalProviderError(
        'provider_network_failed',
        'O provider externo não conseguiu acessar a origem pela rede segura.',
        502
      );
    case 'provider_auth_required':
      return new ExternalProviderError(
        'provider_auth_required',
        'A origem exige autenticação e não pode ser importada sem credenciais.',
        409
      );
    case 'provider_runtime_missing':
      return new ExternalProviderError(
        'provider_runtime_missing',
        'O yt-dlp não encontrou o runtime JavaScript necessário para esta origem.',
        503
      );
    case 'provider_incompatible':
      return new ExternalProviderError(
        'provider_incompatible',
        'A versão instalada do yt-dlp não é compatível com o provider.',
        503
      );
    case 'output_too_large':
      return new ExternalProviderError('output_too_large', 'A mídia retornada pelo provider excede o limite configurado.', 413);
    case 'invalid_output':
      return new ExternalProviderError('invalid_output', 'O provider retornou uma saída inválida.');
    case 'setup_failed':
      return new ExternalProviderError('setup_failed', 'Não foi possível preparar a importação externa.', 500);
    default:
      return new ExternalProviderError('provider_failed', 'Falha ao executar o provider externo.', 502);
  }
}

function publicFailure(error: unknown) {
  if (error instanceof ExternalProviderError) return canonicalFailure(error);
  if (error instanceof ExternalProviderScratchError) {
    return new ExternalProviderError('invalid_output', 'O provider retornou uma saída inválida.');
  }
  return new ExternalProviderError('provider_failed', 'Falha ao executar o provider externo.', 502);
}

function clonePrepared(result: ExternalProviderPreparedResult): ExternalProviderPreparedResult {
  return {
    ...result,
    metadata: { ...result.metadata },
    payload: { ...result.payload }
  };
}

async function *readOutput(
  handle: FileHandle,
  maxOutputBytes: number,
  signal: AbortSignal
) {
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let position = 0;

  while (true) {
    if (signal.aborted) throw abortReason(signal);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) break;
    position += bytesRead;
    if (position > maxOutputBytes) {
      throw new ExternalProviderError('output_too_large', 'A mídia retornada pelo provider excede o limite configurado.', 413);
    }
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }

  if (position === 0) {
    throw new ExternalProviderError('invalid_output', 'O provider retornou um arquivo vazio.');
  }
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new ExternalProviderError('provider_cancelled', 'Importação do provider cancelada.', 409);
}

export class ExternalProviderImportManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly scratch: ExternalProviderScratchManager;
  private readonly providers = new Map<string, ReturnType<typeof normalizeProviderDefinition>>();
  private readonly providerConfigs: Readonly<Record<string, Readonly<Record<string, string>>>>;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly sessions = new Map<string, ProviderSession>();
  private readonly prepared = new Map<string, ExternalProviderPreparedResult>();

  constructor(options: ExternalProviderManagerOptions) {
    if (!Number.isSafeInteger(options.timeoutMs ?? 120_000) || (options.timeoutMs ?? 120_000) <= 0) {
      throw new Error('Timeout de provider inválido.');
    }
    if (!Number.isSafeInteger(options.maxOutputBytes ?? 512 * 1024 * 1024) || (options.maxOutputBytes ?? 512 * 1024 * 1024) <= 0) {
      throw new Error('Limite de saída do provider inválido.');
    }

    this.queue = options.queue;
    this.staging = options.staging;
    this.scratch = options.scratch;
    this.providerConfigs = options.providerConfigs ?? {};
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 512 * 1024 * 1024;

    for (const candidate of options.providers) {
      const definition = normalizeProviderDefinition(candidate);
      if (this.providers.has(definition.id)) throw new Error(`Provider duplicado: ${definition.id}.`);
      this.providers.set(definition.id, definition);
    }
  }

  listProviders(): ExternalProviderDescriptor[] {
    return [...this.providers.values()].map(definition => {
      const config = this.configFor(definition.id);
      return {
        id: definition.id,
        label: definition.label,
        capabilities: { ...definition.capabilities },
        configured: configured(definition.requiredConfigKeys, config)
      };
    });
  }

  getPrepared(jobId: string) {
    const result = this.prepared.get(jobId);
    return result ? clonePrepared(result) : null;
  }

  async start(providerId: string, request: ExternalProviderRequest): Promise<{ job: ImportJob }> {
    const definition = this.requireProvider(providerId);
    const config = this.configFor(definition.id);
    if (!configured(definition.requiredConfigKeys, config)) {
      throw new ExternalProviderError(
        'provider_not_configured',
        `O provider ${definition.label} não está configurado.`,
        503
      );
    }

    const normalizedRequest = normalizeRequest(request);
    try {
      await definition.provider.validate(normalizedRequest);
    } catch (error) {
      if (error instanceof ExternalProviderError && error.code === 'invalid_input') throw error;
      throw new ExternalProviderError('invalid_input', `A URL não é suportada por ${definition.label}.`);
    }

    const job = this.queue.enqueue(
      { type: 'provider', provider: definition.id },
      `${definition.label} · importação externa`
    );

    let scratchDir: string;
    try {
      await this.staging.createJob(job.id);
      scratchDir = (await this.scratch.createJob(job.id)).workspacePath;
    } catch {
      await this.staging.cleanupJob(job.id).catch(() => undefined);
      await this.scratch.cleanupJob(job.id).catch(() => undefined);
      this.queue.transition(job.id, 'failed', 'Não foi possível preparar a importação externa.');
      throw new ExternalProviderError('setup_failed', 'Não foi possível preparar a importação externa.', 500);
    }

    const processing = this.queue.transition(job.id, 'processing')!;
    const controller = new AbortController();
    const session: ProviderSession = {
      controller,
      cancelRequested: false,
      settled: Promise.resolve()
    };
    this.sessions.set(job.id, session);
    session.settled = this.run(job.id, definition, normalizedRequest, config, scratchDir, session);
    return { job: processing };
  }

  async cancel(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ExternalProviderError('provider_not_found', 'Job de provider não encontrado.', 404);
    if (job.source.type !== 'provider') {
      throw new ExternalProviderError('provider_not_found', 'Este job não pertence a um provider externo.', 409);
    }
    if (job.status !== 'processing' && job.status !== 'pending') {
      throw new ExternalProviderError('provider_cancelled', 'Este job não pode mais ser cancelado.', 409);
    }
    if (job.status === 'processing' && this.prepared.has(jobId)) {
      throw new ExternalProviderError(
        'provider_cancelled',
        'A aquisição externa já terminou e a mídia está sendo processada; o staging não pode mais ser cancelado pelo provider.',
        409
      );
    }

    const session = this.sessions.get(jobId);
    if (session) {
      session.cancelRequested = true;
      session.controller.abort(new ExternalProviderError('provider_cancelled', 'Importação do provider cancelada.', 409));
      await session.settled;
    }

    await this.scratch.cleanupJob(jobId).catch(() => undefined);
    await this.staging.cleanupJob(jobId).catch(() => undefined);
    this.prepared.delete(jobId);
    const current = this.queue.get(jobId);
    if (current?.status === 'processing' || current?.status === 'pending') {
      this.queue.transition(jobId, 'cancelled');
    }
    return this.queue.get(jobId)!;
  }

  private async run(
    jobId: string,
    definition: ReturnType<typeof normalizeProviderDefinition>,
    request: ExternalProviderRequest,
    config: ExternalProviderConfig,
    scratchDir: string,
    session: ProviderSession
  ) {
    const timeout = setTimeout(() => {
      session.controller.abort(new ExternalProviderError(
        'provider_timeout',
        'O provider externo excedeu o tempo limite.',
        504
      ));
    }, this.timeoutMs);
    timeout.unref?.();

    const abortPromise = new Promise<never>((_resolve, reject) => {
      const signal = session.controller.signal;
      if (signal.aborted) {
        reject(abortReason(signal));
        return;
      }
      signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
    });

    try {
      const providerPromise = Promise.resolve(definition.provider.prepare(request, {
        scratchDir,
        signal: session.controller.signal,
        config
      }));
      void providerPromise.catch(() => undefined);
      const media = await Promise.race([providerPromise, abortPromise]);
      if (session.controller.signal.aborted) throw abortReason(session.controller.signal);
      if (!media || typeof media.relativePath !== 'string') {
        throw new ExternalProviderError('invalid_output', 'O provider retornou uma saída inválida.');
      }

      const safeOutput = await this.scratch.openOutput(jobId, media.relativePath);
      let writtenSize = 0;
      try {
        const before = await safeOutput.handle.stat();
        if (before.size <= 0) {
          throw new ExternalProviderError('invalid_output', 'O provider retornou um arquivo vazio.');
        }
        if (before.size > this.maxOutputBytes) {
          throw new ExternalProviderError('output_too_large', 'A mídia retornada pelo provider excede o limite configurado.', 413);
        }
        const written = await this.staging.writePayload(
          jobId,
          readOutput(safeOutput.handle, this.maxOutputBytes, session.controller.signal)
        );
        writtenSize = written.size;
        const after = await safeOutput.handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new ExternalProviderError('invalid_output', 'O arquivo do provider mudou durante a cópia.');
        }
      } finally {
        await safeOutput.handle.close();
      }

      if (session.controller.signal.aborted) throw abortReason(session.controller.signal);
      const result: ExternalProviderPreparedResult = {
        jobId,
        provider: definition.id,
        metadata: sanitizeMetadata(media.metadata),
        payload: {
          sizeBytes: writtenSize,
          contentType: sanitizeContentType(media.contentType)
        }
      };
      this.prepared.set(jobId, result);
      await this.scratch.cleanupJob(jobId);
      const current = this.queue.get(jobId);
      if (current?.status === 'processing') this.queue.transition(jobId, 'pending');
    } catch (error) {
      await this.scratch.cleanupJob(jobId).catch(() => undefined);
      await this.staging.cleanupJob(jobId).catch(() => undefined);
      this.prepared.delete(jobId);
      const current = this.queue.get(jobId);
      if (current?.status === 'processing' || current?.status === 'pending') {
        if (session.cancelRequested) {
          this.queue.transition(jobId, 'cancelled');
        } else {
          const failure = publicFailure(error);
          this.queue.transition(jobId, 'failed', failure.message);
        }
      }
    } finally {
      clearTimeout(timeout);
      this.sessions.delete(jobId);
    }
  }

  private requireProvider(providerId: string) {
    const id = normalizeProviderId(providerId);
    const definition = this.providers.get(id);
    if (!definition) throw new ExternalProviderError('provider_not_found', 'Provider externo não encontrado.', 404);
    return definition;
  }

  private configFor(providerId: string): ExternalProviderConfig {
    return Object.freeze({ ...(this.providerConfigs[providerId] ?? {}) });
  }
}
