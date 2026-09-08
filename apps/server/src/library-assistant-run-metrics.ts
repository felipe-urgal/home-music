export type LibraryAssistantProviderObservation = {
  signal?: AbortSignal;
  cache: 'hit' | 'miss';
  externalRequest: boolean;
  rateLimitWaitMs: number;
};

export type LibraryAssistantRunMetricsSnapshot = {
  searchAttempts: number;
  externalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitWaitMs: number;
  retriesTotal: number;
  retriesByReason: Record<string, number>;
};

type RunMetricsState = {
  searchAttempts: number;
  externalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitWaitMs: number;
  retriesTotal: number;
  retriesByReason: Map<string, number>;
};

const MAX_RUNS = 100;

function emptyState(): RunMetricsState {
  return {
    searchAttempts: 0,
    externalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rateLimitWaitMs: 0,
    retriesTotal: 0,
    retriesByReason: new Map()
  };
}

function safeDuration(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeReason(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(normalized) ? normalized : 'unknown';
}

export class LibraryAssistantRunMetrics {
  private readonly runs = new Map<string, RunMetricsState>();
  private readonly signals = new WeakMap<AbortSignal, string>();

  bindSignal(runId: string, signal?: AbortSignal) {
    this.state(runId);
    if (signal) this.signals.set(signal, runId);
  }

  observeProvider(observation: LibraryAssistantProviderObservation) {
    if (!observation.signal) return;
    const runId = this.signals.get(observation.signal);
    if (!runId) return;
    const state = this.state(runId);
    state.searchAttempts += 1;
    if (observation.cache === 'hit') state.cacheHits += 1;
    else state.cacheMisses += 1;
    if (observation.externalRequest) state.externalRequests += 1;
    state.rateLimitWaitMs += safeDuration(observation.rateLimitWaitMs);
  }

  recordRetry(runId: string, reason: string) {
    const state = this.state(runId);
    const normalized = safeReason(reason);
    state.retriesTotal += 1;
    state.retriesByReason.set(normalized, (state.retriesByReason.get(normalized) ?? 0) + 1);
  }

  snapshot(runId: string): LibraryAssistantRunMetricsSnapshot | null {
    const state = this.runs.get(runId);
    if (!state) return null;
    return {
      searchAttempts: state.searchAttempts,
      externalRequests: state.externalRequests,
      cacheHits: state.cacheHits,
      cacheMisses: state.cacheMisses,
      rateLimitWaitMs: state.rateLimitWaitMs,
      retriesTotal: state.retriesTotal,
      retriesByReason: Object.fromEntries([...state.retriesByReason.entries()].sort(([left], [right]) => left.localeCompare(right)))
    };
  }

  private state(runId: string) {
    const existing = this.runs.get(runId);
    if (existing) return existing;
    if (this.runs.size >= MAX_RUNS) {
      const oldest = this.runs.keys().next().value as string | undefined;
      if (oldest) this.runs.delete(oldest);
    }
    const created = emptyState();
    this.runs.set(runId, created);
    return created;
  }
}
