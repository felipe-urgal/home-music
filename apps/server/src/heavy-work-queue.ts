import { AsyncLocalStorage } from 'node:async_hooks';

const MAX_CONCURRENT_LIMIT = 16;
const MAX_PENDING_LIMIT = 512;
const MAX_PENDING_PER_OWNER_LIMIT = 128;
const MAX_RETRY_AFTER_SECONDS = 60;
const SYSTEM_OWNER = 'system';

type HeavyWorkRequestContext = {
  ownerId: string;
  signal?: AbortSignal;
};

const requestContext = new AsyncLocalStorage<HeavyWorkRequestContext>();

export type HeavyWorkQueueRuntime = {
  active: number;
  pending: number;
  rejected: number;
  oldestPendingMs: number;
  lastQueueWaitMs: number;
};

export type HeavyWorkQueueOptions = {
  name: string;
  maxConcurrent: number;
  maxPending: number;
  maxPendingPerOwner: number;
  retryAfterSeconds: number;
  now?: () => number;
};

type Waiter = {
  ownerId: string;
  enqueuedAt: number;
  signal?: AbortSignal;
  onAbort?: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
};

export type HeavyWorkLimits = {
  retryAfterSeconds: number;
  transcode: {
    maxConcurrent: number;
    maxPending: number;
    maxPendingPerOwner: number;
  };
  cover: {
    maxConcurrent: number;
    maxPending: number;
    maxPendingPerOwner: number;
  };
  imports: {
    maxNonTerminal: number;
    maxNonTerminalPerOwner: number;
  };
  integrity: {
    maxConcurrent: number;
    maxPending: number;
    maxPendingPerOwner: number;
  };
};

export const DEFAULT_HEAVY_WORK_LIMITS: HeavyWorkLimits = {
  retryAfterSeconds: 2,
  transcode: {
    maxConcurrent: 1,
    maxPending: 12,
    maxPendingPerOwner: 4
  },
  cover: {
    maxConcurrent: 4,
    maxPending: 32,
    maxPendingPerOwner: 8
  },
  imports: {
    maxNonTerminal: 16,
    maxNonTerminalPerOwner: 8
  },
  integrity: {
    maxConcurrent: 1,
    maxPending: 2,
    maxPendingPerOwner: 1
  }
};

export class HeavyWorkQueueSaturatedError extends Error {
  readonly statusCode = 503;

  constructor(
    public readonly queueName: string,
    public readonly retryAfterSeconds: number
  ) {
    super(`Fila de trabalho ${queueName} temporariamente saturada.`);
    this.name = 'HeavyWorkQueueSaturatedError';
  }
}

export class HeavyWorkQueueAbortedError extends Error {
  constructor(public readonly queueName: string) {
    super(`Espera pela fila de trabalho ${queueName} cancelada.`);
    this.name = 'HeavyWorkQueueAbortedError';
  }
}

export function withHeavyWorkRequestContext<T>(
  context: { ownerId?: string | null; signal?: AbortSignal },
  callback: () => T
) {
  const ownerId = context.ownerId?.trim() || SYSTEM_OWNER;
  return requestContext.run({ ownerId, signal: context.signal }, callback);
}

export function currentHeavyWorkRequestContext(): HeavyWorkRequestContext {
  return requestContext.getStore() ?? { ownerId: SYSTEM_OWNER };
}

function parseLimit(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum: number,
  minimum = 1
) {
  if (value == null || value.trim() === '') return Math.min(maximum, Math.max(minimum, fallback));
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

export function parseHeavyWorkLimits(env: NodeJS.ProcessEnv): HeavyWorkLimits {
  const retryAfterSeconds = parseLimit(
    env.HOME_MUSIC_HEAVY_WORK_RETRY_AFTER_SECONDS,
    'HOME_MUSIC_HEAVY_WORK_RETRY_AFTER_SECONDS',
    DEFAULT_HEAVY_WORK_LIMITS.retryAfterSeconds,
    MAX_RETRY_AFTER_SECONDS
  );
  const transcodeMaxPending = parseLimit(
    env.HOME_MUSIC_TRANSCODE_MAX_PENDING,
    'HOME_MUSIC_TRANSCODE_MAX_PENDING',
    DEFAULT_HEAVY_WORK_LIMITS.transcode.maxPending,
    MAX_PENDING_LIMIT
  );
  const coverMaxPending = parseLimit(
    env.HOME_MUSIC_COVER_MAX_PENDING,
    'HOME_MUSIC_COVER_MAX_PENDING',
    DEFAULT_HEAVY_WORK_LIMITS.cover.maxPending,
    MAX_PENDING_LIMIT
  );
  const importMaxNonTerminal = parseLimit(
    env.HOME_MUSIC_IMPORT_MAX_NON_TERMINAL,
    'HOME_MUSIC_IMPORT_MAX_NON_TERMINAL',
    DEFAULT_HEAVY_WORK_LIMITS.imports.maxNonTerminal,
    MAX_PENDING_LIMIT
  );
  const integrityMaxPending = parseLimit(
    env.HOME_MUSIC_INTEGRITY_MAX_PENDING,
    'HOME_MUSIC_INTEGRITY_MAX_PENDING',
    DEFAULT_HEAVY_WORK_LIMITS.integrity.maxPending,
    MAX_PENDING_LIMIT
  );

  return {
    retryAfterSeconds,
    transcode: {
      maxConcurrent: parseLimit(
        env.HOME_MUSIC_TRANSCODE_MAX_CONCURRENT,
        'HOME_MUSIC_TRANSCODE_MAX_CONCURRENT',
        DEFAULT_HEAVY_WORK_LIMITS.transcode.maxConcurrent,
        MAX_CONCURRENT_LIMIT
      ),
      maxPending: transcodeMaxPending,
      maxPendingPerOwner: parseLimit(
        env.HOME_MUSIC_TRANSCODE_MAX_PENDING_PER_USER,
        'HOME_MUSIC_TRANSCODE_MAX_PENDING_PER_USER',
        DEFAULT_HEAVY_WORK_LIMITS.transcode.maxPendingPerOwner,
        Math.min(MAX_PENDING_PER_OWNER_LIMIT, transcodeMaxPending)
      )
    },
    cover: {
      maxConcurrent: parseLimit(
        env.HOME_MUSIC_COVER_MAX_CONCURRENT,
        'HOME_MUSIC_COVER_MAX_CONCURRENT',
        DEFAULT_HEAVY_WORK_LIMITS.cover.maxConcurrent,
        MAX_CONCURRENT_LIMIT
      ),
      maxPending: coverMaxPending,
      maxPendingPerOwner: parseLimit(
        env.HOME_MUSIC_COVER_MAX_PENDING_PER_USER,
        'HOME_MUSIC_COVER_MAX_PENDING_PER_USER',
        DEFAULT_HEAVY_WORK_LIMITS.cover.maxPendingPerOwner,
        Math.min(MAX_PENDING_PER_OWNER_LIMIT, coverMaxPending)
      )
    },
    imports: {
      maxNonTerminal: importMaxNonTerminal,
      maxNonTerminalPerOwner: parseLimit(
        env.HOME_MUSIC_IMPORT_MAX_NON_TERMINAL_PER_USER,
        'HOME_MUSIC_IMPORT_MAX_NON_TERMINAL_PER_USER',
        DEFAULT_HEAVY_WORK_LIMITS.imports.maxNonTerminalPerOwner,
        Math.min(MAX_PENDING_PER_OWNER_LIMIT, importMaxNonTerminal)
      )
    },
    integrity: {
      maxConcurrent: 1,
      maxPending: integrityMaxPending,
      maxPendingPerOwner: parseLimit(
        env.HOME_MUSIC_INTEGRITY_MAX_PENDING_PER_USER,
        'HOME_MUSIC_INTEGRITY_MAX_PENDING_PER_USER',
        DEFAULT_HEAVY_WORK_LIMITS.integrity.maxPendingPerOwner,
        Math.min(MAX_PENDING_PER_OWNER_LIMIT, integrityMaxPending)
      )
    }
  };
}

function normalizedOwner(ownerId: string | undefined) {
  return ownerId?.trim() || SYSTEM_OWNER;
}

export class HeavyWorkQueue {
  private readonly queuesByOwner = new Map<string, Waiter[]>();
  private readonly ownerOrder: string[] = [];
  private active = 0;
  private pending = 0;
  private rejected = 0;
  private lastQueueWaitMs = 0;
  private readonly now: () => number;

  constructor(private readonly options: HeavyWorkQueueOptions) {
    if (!options.name.trim()) throw new Error('Nome da fila de trabalho obrigatório.');
    if (!Number.isSafeInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error('maxConcurrent da fila de trabalho deve ser positivo.');
    }
    if (!Number.isSafeInteger(options.maxPending) || options.maxPending < 1) {
      throw new Error('maxPending da fila de trabalho deve ser positivo.');
    }
    if (
      !Number.isSafeInteger(options.maxPendingPerOwner)
      || options.maxPendingPerOwner < 1
      || options.maxPendingPerOwner > options.maxPending
    ) {
      throw new Error('maxPendingPerOwner da fila de trabalho deve estar entre 1 e maxPending.');
    }
    this.now = options.now ?? Date.now;
  }

  get runtime(): HeavyWorkQueueRuntime {
    let oldestPendingMs = 0;
    const now = this.now();
    for (const queue of this.queuesByOwner.values()) {
      for (const waiter of queue) {
        oldestPendingMs = Math.max(oldestPendingMs, Math.max(0, now - waiter.enqueuedAt));
      }
    }
    return {
      active: this.active,
      pending: this.pending,
      rejected: this.rejected,
      oldestPendingMs,
      lastQueueWaitMs: this.lastQueueWaitMs
    };
  }

  async run<T>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const context = currentHeavyWorkRequestContext();
    await this.acquire(context.ownerId, context.signal);
    try {
      if (context.signal?.aborted) throw new HeavyWorkQueueAbortedError(this.options.name);
      return await operation(context.signal);
    } finally {
      this.release();
    }
  }

  private acquire(ownerIdInput: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new HeavyWorkQueueAbortedError(this.options.name));

    if (this.active < this.options.maxConcurrent && this.pending === 0) {
      this.active += 1;
      this.lastQueueWaitMs = 0;
      return Promise.resolve();
    }

    const ownerId = normalizedOwner(ownerIdInput);
    const ownerQueue = this.queuesByOwner.get(ownerId) ?? [];
    if (this.pending >= this.options.maxPending || ownerQueue.length >= this.options.maxPendingPerOwner) {
      this.rejected += 1;
      return Promise.reject(new HeavyWorkQueueSaturatedError(
        this.options.name,
        this.options.retryAfterSeconds
      ));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        ownerId,
        enqueuedAt: this.now(),
        signal,
        resolve,
        reject
      };
      if (signal) {
        waiter.onAbort = () => {
          if (!this.removeWaiter(waiter)) return;
          reject(new HeavyWorkQueueAbortedError(this.options.name));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      if (ownerQueue.length === 0) this.ownerOrder.push(ownerId);
      ownerQueue.push(waiter);
      this.queuesByOwner.set(ownerId, ownerQueue);
      this.pending += 1;
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    this.drain();
  }

  private drain() {
    while (this.active < this.options.maxConcurrent && this.pending > 0) {
      const waiter = this.nextWaiter();
      if (!waiter) return;
      if (waiter.signal?.aborted) {
        waiter.reject(new HeavyWorkQueueAbortedError(this.options.name));
        continue;
      }
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener('abort', waiter.onAbort);
      }
      this.active += 1;
      this.lastQueueWaitMs = Math.max(0, this.now() - waiter.enqueuedAt);
      waiter.resolve();
    }
  }

  private nextWaiter() {
    while (this.ownerOrder.length > 0) {
      const ownerId = this.ownerOrder.shift()!;
      const ownerQueue = this.queuesByOwner.get(ownerId);
      if (!ownerQueue?.length) {
        this.queuesByOwner.delete(ownerId);
        continue;
      }
      const waiter = ownerQueue.shift()!;
      this.pending = Math.max(0, this.pending - 1);
      if (ownerQueue.length > 0) this.ownerOrder.push(ownerId);
      else this.queuesByOwner.delete(ownerId);
      return waiter;
    }
    return null;
  }

  private removeWaiter(waiter: Waiter) {
    const ownerQueue = this.queuesByOwner.get(waiter.ownerId);
    if (!ownerQueue) return false;
    const index = ownerQueue.indexOf(waiter);
    if (index < 0) return false;
    ownerQueue.splice(index, 1);
    this.pending = Math.max(0, this.pending - 1);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    if (ownerQueue.length === 0) {
      this.queuesByOwner.delete(waiter.ownerId);
      const orderIndex = this.ownerOrder.indexOf(waiter.ownerId);
      if (orderIndex >= 0) this.ownerOrder.splice(orderIndex, 1);
    }
    return true;
  }
}
