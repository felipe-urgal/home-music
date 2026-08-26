export type OfflineDownloadTask = () => Promise<void>;

export class OfflineDownloadScheduler {
  private readonly queued: Array<{
    trackId: string;
    task: OfflineDownloadTask;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly listeners = new Set<(trackIds: Set<string>) => void>();
  private active = 0;

  constructor(private readonly maxConcurrent = 3) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError('Concorrência de download precisa ser um inteiro positivo.');
    }
  }

  get pendingIds() {
    return new Set(this.jobs.keys());
  }

  enqueue(trackId: string, task: OfflineDownloadTask) {
    const existing = this.jobs.get(trackId);
    if (existing) return existing;

    let resolveJob!: () => void;
    let rejectJob!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });

    this.jobs.set(trackId, promise);
    this.queued.push({ trackId, task, resolve: resolveJob, reject: rejectJob });
    this.emit();
    this.drain();
    return promise;
  }

  subscribe(listener: (trackIds: Set<string>) => void) {
    this.listeners.add(listener);
    listener(this.pendingIds);
    return () => this.listeners.delete(listener);
  }

  private drain() {
    while (this.active < this.maxConcurrent && this.queued.length > 0) {
      const job = this.queued.shift();
      if (!job) break;
      this.active += 1;

      void job.task()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.jobs.delete(job.trackId);
          this.emit();
          this.drain();
        });
    }
  }

  private emit() {
    const snapshot = this.pendingIds;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const offlineDownloadScheduler = new OfflineDownloadScheduler(3);
