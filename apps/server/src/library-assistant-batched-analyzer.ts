import type { Track } from '@home-music/shared';
import type { LibraryAssistantProviderGateway, LibraryAssistantProviderQuery } from './library-assistant-provider.js';
import type { LibraryAssistantAnalyzer, LibraryAssistantSuggestionDraft } from './library-assistant-service.js';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
const DEFAULT_FAILURE_BACKOFF_MS = 15_000;
const DEFAULT_FAILURES_BEFORE_BACKOFF = 2;
const DEFAULT_MAX_RETRY_PASSES = 2;
const RECOVERABLE_PROVIDER_CODES = new Set([
  'provider-timeout',
  'provider-rate-limited',
  'provider-request-failed',
  'provider-unavailable'
]);

type BatchProgress = {
  analyzerId: string;
  processedTracks: number;
  totalTracks: number;
  deferredTracks: number;
  failedTracks: number;
  retryPass: number;
};

type TrackAttempt = {
  analyzerId: string;
  trackId: string;
  durationMs: number;
  error: unknown;
  attempt: number;
};

type CircuitCooldown = {
  analyzerId: string;
  cooldownMs: number;
  consecutiveFailures: number;
  deferredTracks: number;
  retryPass: number;
};

type BatchedAnalyzerOptions = {
  batchSize?: number;
  providerTimeoutMs?: number;
  failureBackoffMs?: number;
  failuresBeforeBackoff?: number;
  maxRetryPasses?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  onProgress?: (progress: BatchProgress) => void;
  onTrackDeferred?: (attempt: TrackAttempt) => void;
  onTrackFailure?: (failure: TrackAttempt) => void;
  onCircuitCooldown?: (cooldown: CircuitCooldown) => void;
};

type DeferredTrack = {
  track: Track;
  attempts: number;
  lastDurationMs: number;
  lastError: unknown;
};

function isCancellation(error: unknown, signal?: AbortSignal) {
  return signal?.aborted || (error instanceof Error && (
    error.name === 'AbortError'
    || error.name === 'LibraryAssistantProviderAbortedError'
  ));
}

function isRecoverableProviderFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  if ('code' in error && RECOVERABLE_PROVIDER_CODES.has(String(error.code))) return true;
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return true;
  const cause = 'cause' in error && error.cause && typeof error.cause === 'object'
    ? error.cause as { code?: unknown }
    : null;
  return Boolean(cause?.code && /^(?:UND_ERR_|E(?:AI_AGAIN|CONNRESET|CONNREFUSED|TIMEDOUT|HOSTUNREACH|NETUNREACH))/i.test(String(cause.code)));
}

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

function defaultSleep(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const abort = () => {
      clearTimeout(timer);
      finish(() => reject(abortError()));
    };
    timer = setTimeout(() => finish(resolve), delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`Valor deve estar entre ${minimum} e ${maximum}.`);
  }
  return resolved;
}

function providersWithTimeout(
  providers: LibraryAssistantProviderGateway,
  timeoutMs: number
): LibraryAssistantProviderGateway {
  return new Proxy(providers, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return <T>(query: LibraryAssistantProviderQuery<T>) => target.query({
        ...query,
        timeoutMs: query.timeoutMs ?? timeoutMs
      });
    }
  });
}

export function createBatchedLibraryAssistantAnalyzer(
  analyzer: LibraryAssistantAnalyzer,
  options: BatchedAnalyzerOptions = {}
): LibraryAssistantAnalyzer {
  const batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, 100);
  const providerTimeoutMs = boundedInteger(
    options.providerTimeoutMs,
    DEFAULT_PROVIDER_TIMEOUT_MS,
    100,
    30_000
  );
  const failureBackoffMs = boundedInteger(
    options.failureBackoffMs,
    DEFAULT_FAILURE_BACKOFF_MS,
    0,
    60_000
  );
  const failuresBeforeBackoff = boundedInteger(
    options.failuresBeforeBackoff,
    DEFAULT_FAILURES_BEFORE_BACKOFF,
    1,
    20
  );
  const maxRetryPasses = boundedInteger(
    options.maxRetryPasses,
    DEFAULT_MAX_RETRY_PASSES,
    0,
    5
  );
  const sleep = options.sleep ?? defaultSleep;

  return {
    id: `${analyzer.id}-batched-${batchSize}`,
    capability: analyzer.capability,
    async analyze(context) {
      const drafts: LibraryAssistantSuggestionDraft[] = [];
      let deferred = new Map<string, DeferredTrack>();
      const failedTrackIds = new Set<string>();
      const timedProviders = providersWithTimeout(context.providers, providerTimeoutMs);
      const totalTracks = context.tracks.length;

      const analyzeTracks = (tracks: readonly Track[]) => analyzer.analyze({
        ...context,
        tracks,
        providers: timedProviders
      });

      const defer = (track: Track, durationMs: number, error: unknown) => {
        const previous = deferred.get(track.id);
        const item: DeferredTrack = {
          track,
          attempts: (previous?.attempts ?? 0) + 1,
          lastDurationMs: durationMs,
          lastError: error
        };
        deferred.set(track.id, item);
        options.onTrackDeferred?.({
          analyzerId: analyzer.id,
          trackId: track.id,
          durationMs,
          error,
          attempt: item.attempts
        });
      };

      const cooldown = async (consecutiveFailures: number, retryPass: number) => {
        options.onCircuitCooldown?.({
          analyzerId: analyzer.id,
          cooldownMs: failureBackoffMs,
          consecutiveFailures,
          deferredTracks: deferred.size,
          retryPass
        });
        await sleep(failureBackoffMs, context.signal);
      };

      for (let offset = 0; offset < totalTracks; offset += batchSize) {
        if (context.signal?.aborted) break;
        const batch = context.tracks.slice(offset, offset + batchSize);

        try {
          drafts.push(...await analyzeTracks(batch));
        } catch (error) {
          if (isCancellation(error, context.signal)) throw error;
          if (!isRecoverableProviderFailure(error)) throw error;

          let consecutiveFailures = 0;
          for (const track of batch) {
            if (context.signal?.aborted) break;
            const startedAt = Date.now();
            try {
              drafts.push(...await analyzeTracks([track]));
              deferred.delete(track.id);
              consecutiveFailures = 0;
            } catch (trackError) {
              if (isCancellation(trackError, context.signal)) throw trackError;
              if (!isRecoverableProviderFailure(trackError)) throw trackError;
              const durationMs = Math.max(0, Date.now() - startedAt);
              defer(track, durationMs, trackError);
              consecutiveFailures += 1;

              if (consecutiveFailures >= failuresBeforeBackoff) {
                await cooldown(consecutiveFailures, 0);
                consecutiveFailures = 0;
              }
            }
          }
        }

        options.onProgress?.({
          analyzerId: analyzer.id,
          processedTracks: Math.min(offset + batch.length, totalTracks),
          totalTracks,
          deferredTracks: deferred.size,
          failedTracks: 0,
          retryPass: 0
        });
      }

      for (let retryPass = 1; retryPass <= maxRetryPasses && deferred.size > 0; retryPass += 1) {
        await sleep(failureBackoffMs, context.signal);
        const pending = [...deferred.values()];
        const nextDeferred = new Map<string, DeferredTrack>();
        let consecutiveFailures = 0;

        for (const pendingTrack of pending) {
          if (context.signal?.aborted) break;
          const startedAt = Date.now();
          try {
            drafts.push(...await analyzeTracks([pendingTrack.track]));
            consecutiveFailures = 0;
          } catch (error) {
            if (isCancellation(error, context.signal)) throw error;
            if (!isRecoverableProviderFailure(error)) throw error;
            const durationMs = Math.max(0, Date.now() - startedAt);
            const item: DeferredTrack = {
              track: pendingTrack.track,
              attempts: pendingTrack.attempts + 1,
              lastDurationMs: durationMs,
              lastError: error
            };
            nextDeferred.set(item.track.id, item);
            options.onTrackDeferred?.({
              analyzerId: analyzer.id,
              trackId: item.track.id,
              durationMs,
              error,
              attempt: item.attempts
            });
            consecutiveFailures += 1;

            if (consecutiveFailures >= failuresBeforeBackoff) {
              deferred = nextDeferred;
              await cooldown(consecutiveFailures, retryPass);
              consecutiveFailures = 0;
            }
          }
        }

        deferred = nextDeferred;
        options.onProgress?.({
          analyzerId: analyzer.id,
          processedTracks: totalTracks,
          totalTracks,
          deferredTracks: deferred.size,
          failedTracks: 0,
          retryPass
        });
      }

      for (const item of deferred.values()) {
        failedTrackIds.add(item.track.id);
        options.onTrackFailure?.({
          analyzerId: analyzer.id,
          trackId: item.track.id,
          durationMs: item.lastDurationMs,
          error: item.lastError,
          attempt: item.attempts
        });
      }

      if (deferred.size > 0) {
        options.onProgress?.({
          analyzerId: analyzer.id,
          processedTracks: totalTracks,
          totalTracks,
          deferredTracks: 0,
          failedTracks: failedTrackIds.size,
          retryPass: maxRetryPasses
        });
      }

      if (totalTracks > 0 && failedTrackIds.size === totalTracks) {
        const error = new Error('O provider não conseguiu analisar nenhuma faixa desta biblioteca.');
        Object.assign(error, { code: 'provider-unavailable' });
        throw error;
      }

      return drafts;
    }
  };
}
