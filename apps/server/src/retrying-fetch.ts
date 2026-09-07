type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type RetryingFetchOptions = {
  retryStatuses?: readonly number[];
  retryDelaysMs?: readonly number[];
  maxRetryAfterMs?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

const DEFAULT_RETRY_STATUSES = [429, 503] as const;
const DEFAULT_RETRY_DELAYS_MS = [1_200, 2_400] as const;
const DEFAULT_MAX_RETRY_AFTER_MS = 2_500;

function abortedError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function defaultSleep(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortedError(signal));
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortedError(signal));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function retryAfterMs(value: string | null, now: number, maximum: number) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(maximum, Math.round(seconds * 1_000));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 0;
  return Math.min(maximum, Math.max(0, date - now));
}

export function createRetryingFetch(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  options: RetryingFetchOptions = {}
): FetchLike {
  const retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maximumRetryAfterMs = Math.max(0, Math.trunc(
    options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS
  ));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  return async (input, init) => {
    const signal = init?.signal ?? undefined;
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw abortedError(signal);
      const response = await fetchImpl(input, init);
      if (!retryStatuses.has(response.status) || attempt >= retryDelaysMs.length) return response;

      const configuredDelay = Math.max(0, Math.trunc(retryDelaysMs[attempt] ?? 0));
      const providerDelay = retryAfterMs(
        response.headers.get('retry-after'),
        now(),
        maximumRetryAfterMs
      );
      try {
        await response.body?.cancel();
      } catch {
        // A resposta será descartada; falha ao liberar o body não deve bloquear o retry.
      }
      await sleep(Math.max(configuredDelay, providerDelay), signal);
    }
  };
}
