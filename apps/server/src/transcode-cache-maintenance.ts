import { chmod, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const FINAL_CACHE_FILE = /^[a-f0-9]{64}\.m4a$/;
const TEMP_CACHE_FILE = /^[a-f0-9]{64}\.m4a\.tmp-[a-f0-9-]{8,}$/;

type CacheFile = {
  path: string;
  size: number;
  temporary: boolean;
};

export type TranscodeCacheRuntime = {
  active: number;
  pending: number;
};

export type TranscodeCacheStatus = {
  bytes: number;
  limitBytes: number;
  entries: number;
  temporaryEntries: number;
  active: number;
  pending: number;
};

export type TranscodeCacheClearResult = {
  freedBytes: number;
  removedEntries: number;
  failedEntries: number;
  cache: TranscodeCacheStatus;
};

export class TranscodeCacheBusyError extends Error {
  readonly statusCode = 409;

  constructor(public readonly cache: TranscodeCacheStatus) {
    super('Há transcoding em andamento. Aguarde a atividade terminar antes de limpar o cache.');
    this.name = 'TranscodeCacheBusyError';
  }
}

export class UnsafeTranscodeCacheDirectoryError extends Error {
  constructor() {
    super('O diretório do cache de transcoding é inseguro ou inválido.');
    this.name = 'UnsafeTranscodeCacheDirectoryError';
  }
}

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export class TranscodeCacheMaintenance {
  private maintenanceActive = false;
  private activeOperations = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: {
    cacheDir: string;
    limitBytes: number;
    runtime: () => TranscodeCacheRuntime;
  }) {}

  async withTranscode<T>(operation: () => Promise<T>): Promise<T> {
    await this.enterOperation();
    try {
      return await operation();
    } finally {
      this.activeOperations = Math.max(0, this.activeOperations - 1);
    }
  }

  async status(): Promise<TranscodeCacheStatus> {
    const files = await this.scanFiles();
    return this.buildStatus(files);
  }

  async clear(): Promise<TranscodeCacheClearResult> {
    await this.beginMaintenance();
    try {
      const before = await this.scanFiles();
      const runtime = this.runtime();
      if (this.activeOperations > 0 || runtime.active > 0 || runtime.pending > 0) {
        throw new TranscodeCacheBusyError(this.buildStatus(before));
      }

      let failedEntries = 0;
      for (const file of before) {
        try {
          await rm(file.path, { force: true });
        } catch {
          failedEntries += 1;
        }
      }

      const after = await this.scanFiles();
      const beforeBytes = before.reduce((sum, file) => sum + file.size, 0);
      const afterBytes = after.reduce((sum, file) => sum + file.size, 0);
      return {
        freedBytes: Math.max(0, beforeBytes - afterBytes),
        removedEntries: Math.max(0, before.length - after.length),
        failedEntries,
        cache: this.buildStatus(after)
      };
    } finally {
      this.endMaintenance();
    }
  }

  private runtime() {
    const runtime = this.options.runtime();
    return {
      active: safeCount(runtime.active),
      pending: safeCount(runtime.pending)
    };
  }

  private async enterOperation() {
    while (this.maintenanceActive) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.activeOperations += 1;
  }

  private async beginMaintenance() {
    while (this.maintenanceActive) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.maintenanceActive = true;
  }

  private endMaintenance() {
    this.maintenanceActive = false;
    const waiters = this.waiters.splice(0);
    waiters.forEach(resolve => resolve());
  }

  private async ensureSafeCacheDirectory() {
    await mkdir(this.options.cacheDir, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.options.cacheDir);
    if (directory.isSymbolicLink() || !directory.isDirectory()) {
      throw new UnsafeTranscodeCacheDirectoryError();
    }
    await chmod(this.options.cacheDir, 0o700);
  }

  private async scanFiles() {
    await this.ensureSafeCacheDirectory();
    const entries = await readdir(this.options.cacheDir, { withFileTypes: true });
    const files: CacheFile[] = [];

    for (const entry of entries) {
      const temporary = TEMP_CACHE_FILE.test(entry.name);
      if (!FINAL_CACHE_FILE.test(entry.name) && !temporary) continue;
      if (!entry.isFile()) continue;

      const filePath = path.join(this.options.cacheDir, entry.name);
      try {
        const info = await lstat(filePath);
        if (!info.isFile() || info.isSymbolicLink()) continue;
        files.push({ path: filePath, size: Math.max(0, info.size), temporary });
      } catch {
        // O arquivo pode ter desaparecido entre readdir e lstat.
      }
    }

    return files;
  }

  private buildStatus(files: CacheFile[]): TranscodeCacheStatus {
    const runtime = this.runtime();
    return {
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      limitBytes: Math.max(0, this.options.limitBytes),
      entries: files.filter(file => !file.temporary).length,
      temporaryEntries: files.filter(file => file.temporary).length,
      active: Math.max(runtime.active, this.activeOperations),
      pending: runtime.pending
    };
  }
}
