export class LibraryMutationQueueFullError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Fila de mutações da biblioteca temporariamente cheia.');
    this.name = 'LibraryMutationQueueFullError';
  }
}

type LockOptions = {
  maxPending?: number;
  onWait?: (milliseconds: number) => void;
};

export class LibraryMutationLock {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private active = 0;
  private lastWaitMs = 0;
  private readonly maxPending: number;
  private readonly onWait: (milliseconds: number) => void;

  constructor(options: LockOptions = {}) {
    this.maxPending = options.maxPending ?? 128;
    this.onWait = options.onWait ?? (() => undefined);
  }

  stats() {
    return { active: this.active, pending: this.pending, lastWaitMs: this.lastWaitMs };
  }

  waitForIdle() {
    return this.tail;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending >= this.maxPending) throw new LibraryMutationQueueFullError();

    const enqueuedAt = performance.now();
    this.pending += 1;
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => {
      release = resolve;
    });

    try {
      await previous;
      this.pending -= 1;
      this.active = 1;
      this.lastWaitMs = Math.max(0, performance.now() - enqueuedAt);
      this.onWait(this.lastWaitMs);
      return await operation();
    } finally {
      this.active = 0;
      // If the previous operation unexpectedly failed, the queue is still freed.
      release();
    }
  }
}
