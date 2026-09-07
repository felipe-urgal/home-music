import type { Track } from '@home-music/shared';
import type { LibraryAssistantProviderGateway, LibraryAssistantProviderQuery } from './library-assistant-provider.js';
import type { LibraryAssistantAnalyzer, LibraryAssistantSuggestionDraft } from './library-assistant-service.js';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const MAX_CONSECUTIVE_TRACK_FAILURES = 2;
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
  failedTracks: number;
};

type TrackFailure = {
  analyzerId: string;
  trackId: string;
  durationMs: number;
  error: unknown;
};

type BatchedAnalyzerOptions = {
  batchSize?: number;
  providerTimeoutMs?: number;
  onProgress?: (progress: BatchProgress) => void;
  onTrackFailure?: (failure: TrackFailure) => void;
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

  return {
    id: `${analyzer.id}-batched-${batchSize}`,
    capability: analyzer.capability,
    async analyze(context) {
      const drafts: LibraryAssistantSuggestionDraft[] = [];
      const failedTrackIds = new Set<string>();
      const timedProviders = providersWithTimeout(context.providers, providerTimeoutMs);
      const totalTracks = context.tracks.length;

      const analyzeTracks = (tracks: readonly Track[]) => analyzer.analyze({
        ...context,
        tracks,
        providers: timedProviders
      });

      for (let offset = 0; offset < totalTracks; offset += batchSize) {
        if (context.signal?.aborted) break;
        const batch = context.tracks.slice(offset, offset + batchSize);

        try {
          drafts.push(...await analyzeTracks(batch));
        } catch (error) {
          if (isCancellation(error, context.signal)) throw error;
          if (!isRecoverableProviderFailure(error)) throw error;

          let consecutiveFailures = 0;
          for (let index = 0; index < batch.length; index += 1) {
            const track = batch[index];
            if (context.signal?.aborted) break;

            const startedAt = Date.now();
            try {
              drafts.push(...await analyzeTracks([track]));
              consecutiveFailures = 0;
            } catch (trackError) {
              if (isCancellation(trackError, context.signal)) throw trackError;
              if (!isRecoverableProviderFailure(trackError)) throw trackError;
              consecutiveFailures += 1;
              failedTrackIds.add(track.id);
              options.onTrackFailure?.({
                analyzerId: analyzer.id,
                trackId: track.id,
                durationMs: Math.max(0, Date.now() - startedAt),
                error: trackError
              });

              if (consecutiveFailures >= MAX_CONSECUTIVE_TRACK_FAILURES) {
                for (const skipped of batch.slice(index + 1)) failedTrackIds.add(skipped.id);
                break;
              }
            }
          }
        }

        options.onProgress?.({
          analyzerId: analyzer.id,
          processedTracks: Math.min(offset + batch.length, totalTracks),
          totalTracks,
          failedTracks: failedTrackIds.size
        });
      }

      if (totalTracks > 0 && failedTrackIds.size === totalTracks) {
        const error = new Error('O provider não conseguiu analisar nenhuma faixa deste lote de biblioteca.');
        Object.assign(error, { code: 'provider-unavailable' });
        throw error;
      }

      return drafts;
    }
  };
}
