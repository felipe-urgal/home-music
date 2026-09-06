import { createHash } from 'node:crypto';
import type { LibraryAssistantProvenanceSource } from '@home-music/shared/library-assistant';
import type {
  LibraryAssistantProviderCacheEntry,
  LibraryAssistantProviderCacheKey
} from './library-assistant-store.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const MAX_CACHE_KEY_LENGTH = 2_048;
const MAX_USER_AGENT_LENGTH = 256;
const SENSITIVE_CACHE_KEY = /(?:authorization|cookie|password|passwd|token|secret|api[_-]?key)\s*[:=]/i;

type ProviderCachePort = {
  getProviderCache: (
    key: LibraryAssistantProviderCacheKey,
    nowMs: number
  ) => LibraryAssistantProviderCacheEntry | null;
  putProviderCache: (
    key: LibraryAssistantProviderCacheKey,
    payload: unknown,
    expiresAtMs: number,
    updatedAt: string
  ) => void;
  deleteProviderCache: (key: LibraryAssistantProviderCacheKey) => void;
};

type ProviderGatewayOptions = {
  now?: () => Date;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  minIntervalMs?: number;
};

export type LibraryAssistantProviderDescriptor = {
  source: LibraryAssistantProvenanceSource;
  version: string;
  userAgent: string;
};

export type LibraryAssistantProviderQuery<T> = {
  provider: LibraryAssistantProviderDescriptor;
  cacheKey: string;
  ttlMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  execute: (context: { signal: AbortSignal; userAgent: string }) => Promise<unknown>;
  normalize: (payload: unknown) => T;
};

export type LibraryAssistantProviderQueryResult<T> = {
  value: T;
  cache: 'hit' | 'miss';
};

export class LibraryAssistantProviderTimeoutError extends Error {
  readonly code = 'provider-timeout';

  constructor(public readonly provider: LibraryAssistantProvenanceSource) {
    super('O provider não respondeu dentro do limite configurado.');
    this.name = 'LibraryAssistantProviderTimeoutError';
  }
}

export class LibraryAssistantProviderAbortedError extends Error {
  readonly code = 'provider-aborted';

  constructor() {
    super('Consulta ao provider cancelada.');
    this.name = 'LibraryAssistantProviderAbortedError';
  }
}

export class LibraryAssistantProviderResponseError extends Error {
  readonly code = 'provider-response-invalid';

  constructor() {
    super('O provider retornou dados incompatíveis com o contrato esperado.');
    this.name = 'LibraryAssistantProviderResponseError';
  }
}

function defaultSleep(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new LibraryAssistantProviderAbortedError());
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new LibraryAssistantProviderAbortedError());
    };
    timer = setTimeout(finish, delayMs);
    timer.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function safeIdentifier(value: string, label: string, maximum: number) {
  const clean = value.trim();
  if (!clean || clean.length > maximum || !/^[A-Za-z0-9._:/+ -]+$/.test(clean)) {
    throw new TypeError(`${label} inválido.`);
  }
  return clean;
}

function resolveTimeout(value: number | undefined) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs deve estar entre 100 e ${MAX_TIMEOUT_MS}.`);
  }
  return timeoutMs;
}

function resolveTtl(value: number | undefined) {
  const ttlMs = value ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
    throw new RangeError(`ttlMs deve estar entre 1000 e ${MAX_TTL_MS}.`);
  }
  return ttlMs;
}

function providerCacheKey(query: LibraryAssistantProviderQuery<unknown>): LibraryAssistantProviderCacheKey {
  const provider = safeIdentifier(query.provider.source, 'provider', 64);
  const providerVersion = safeIdentifier(query.provider.version, 'providerVersion', 64);
  if (!query.cacheKey || query.cacheKey.length > MAX_CACHE_KEY_LENGTH || SENSITIVE_CACHE_KEY.test(query.cacheKey)) {
    throw new TypeError('Chave de cache do provider inválida ou contém dado sensível.');
  }
  return {
    provider,
    providerVersion,
    cacheKeyHash: createHash('sha256').update(query.cacheKey).digest('hex')
  };
}

function normalizeUserAgent(value: string) {
  const clean = value.trim();
  if (!clean || clean.length > MAX_USER_AGENT_LENGTH || /[\r\n]/.test(clean)) {
    throw new TypeError('User-Agent do provider inválido.');
  }
  return clean;
}

function normalizeResponse<T>(normalize: (payload: unknown) => T, payload: unknown) {
  try {
    return normalize(payload);
  } catch (error) {
    if (error instanceof LibraryAssistantProviderResponseError) throw error;
    throw new LibraryAssistantProviderResponseError();
  }
}

export class LibraryAssistantProviderGateway {
  private readonly now: () => Date;
  private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<LibraryAssistantProviderQueryResult<unknown>>>();

  constructor(
    private readonly cache: ProviderCachePort,
    options: ProviderGatewayOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? defaultSleep;
    this.minIntervalMs = Math.max(0, Math.min(60_000, Math.trunc(
      options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
    )));
  }

  query<T>(query: LibraryAssistantProviderQuery<T>): Promise<LibraryAssistantProviderQueryResult<T>> {
    const key = providerCacheKey(query as LibraryAssistantProviderQuery<unknown>);
    const inflightKey = `${key.provider}:${key.providerVersion}:${key.cacheKeyHash}`;
    const existing = this.inFlight.get(inflightKey);
    if (existing) return existing as Promise<LibraryAssistantProviderQueryResult<T>>;

    const operation = this.performQuery(query, key)
      .finally(() => this.inFlight.delete(inflightKey));
    this.inFlight.set(inflightKey, operation as Promise<LibraryAssistantProviderQueryResult<unknown>>);
    return operation;
  }

  private async performQuery<T>(
    query: LibraryAssistantProviderQuery<T>,
    key: LibraryAssistantProviderCacheKey
  ): Promise<LibraryAssistantProviderQueryResult<T>> {
    const userAgent = normalizeUserAgent(query.provider.userAgent);
    const timeoutMs = resolveTimeout(query.timeoutMs);
    const ttlMs = resolveTtl(query.ttlMs);
    const nowMs = this.now().getTime();

    try {
      const cached = this.cache.getProviderCache(key, nowMs);
      if (cached) {
        try {
          return { value: normalizeResponse(query.normalize, cached.payload), cache: 'hit' };
        } catch {
          try {
            this.cache.deleteProviderCache(key);
          } catch {
            // Cache é derivado; falha de invalidação não pode bloquear análise.
          }
        }
      }
    } catch {
      // Cache é derivado; leitura indisponível degrada para consulta ao provider.
    }

    await this.waitForRateLimit(key.provider, query.signal);
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (query.signal?.aborted) throw new LibraryAssistantProviderAbortedError();
    query.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();

    try {
      const raw = await query.execute({ signal: controller.signal, userAgent });
      if (query.signal?.aborted) throw new LibraryAssistantProviderAbortedError();
      if (timedOut) throw new LibraryAssistantProviderTimeoutError(query.provider.source);
      const value = normalizeResponse(query.normalize, raw);
      const updatedAt = this.now();
      try {
        this.cache.putProviderCache(key, value, updatedAt.getTime() + ttlMs, updatedAt.toISOString());
      } catch {
        // Resultado normalizado continua válido mesmo quando o cache derivado falha.
      }
      return { value, cache: 'miss' };
    } catch (error) {
      if (query.signal?.aborted) throw new LibraryAssistantProviderAbortedError();
      if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
        throw new LibraryAssistantProviderTimeoutError(query.provider.source);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      query.signal?.removeEventListener('abort', abort);
    }
  }

  private async waitForRateLimit(provider: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new LibraryAssistantProviderAbortedError();
    if (this.minIntervalMs === 0) return;
    const nowMs = this.now().getTime();
    const previous = this.nextAllowedAt.get(provider) ?? nowMs;
    const scheduledAt = Math.max(nowMs, previous);
    this.nextAllowedAt.set(provider, scheduledAt + this.minIntervalMs);
    const delay = scheduledAt - nowMs;
    if (delay > 0) await this.sleep(delay, signal);
  }
}
