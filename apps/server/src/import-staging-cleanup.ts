import path from 'node:path';
import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises';
import type { ImportStagingManager } from './import-staging.js';
import { isPathInside } from './security.js';

export const DEFAULT_IMPORT_STAGING_TTL_HOURS = 24;
export const DEFAULT_IMPORT_STAGING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MIN_IMPORT_STAGING_TTL_HOURS = 1;
const MAX_IMPORT_STAGING_TTL_HOURS = 24 * 30;
const MAX_WORKSPACE_NAME_LENGTH = 128;

type CleanupReason = 'startup' | 'interval' | 'manual';

type CleanupLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
};

export type ImportStagingCleanupSummary = Readonly<{
  reason: CleanupReason;
  scanned: number;
  removed: number;
  skippedActive: number;
  skippedFresh: number;
  ignored: number;
  failed: number;
}>;

type ImportStagingCleanupManagerOptions = {
  staging: ImportStagingManager;
  ttlMs?: number;
  intervalMs?: number;
  now?: () => number;
  logger?: CleanupLogger;
};

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function isMissing(error: unknown) {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function workspaceName(name: string) {
  return name.startsWith('job-') && name.length > 4 && name.length <= MAX_WORKSPACE_NAME_LENGTH;
}

export function parseImportStagingTtlHours(value: string | undefined) {
  if (value == null || !value.trim()) return DEFAULT_IMPORT_STAGING_TTL_HOURS;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error('HOME_MUSIC_IMPORT_STAGING_TTL_HOURS deve ser um inteiro positivo.');
  }
  const parsed = Number(value.trim());
  if (parsed < MIN_IMPORT_STAGING_TTL_HOURS || parsed > MAX_IMPORT_STAGING_TTL_HOURS) {
    throw new Error(
      `HOME_MUSIC_IMPORT_STAGING_TTL_HOURS deve ficar entre ${MIN_IMPORT_STAGING_TTL_HOURS} e ${MAX_IMPORT_STAGING_TTL_HOURS}.`
    );
  }
  return parsed;
}

async function lastActivityMs(candidatePath: string, directory: boolean) {
  const entry = await lstat(candidatePath);
  let latest = entry.mtimeMs;
  if (!directory) return latest;

  let names: string[];
  try {
    names = await readdir(candidatePath);
  } catch (error) {
    if (isMissing(error)) return latest;
    throw error;
  }

  for (const name of names) {
    try {
      const child = await lstat(path.join(candidatePath, name));
      latest = Math.max(latest, child.mtimeMs);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return latest;
}

export class ImportStagingCleanupManager {
  private readonly staging: ImportStagingManager;
  private readonly ttlMs: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly logger?: CleanupLogger;
  private timer: NodeJS.Timeout | null = null;
  private sweepPromise: Promise<ImportStagingCleanupSummary> | null = null;

  constructor(options: ImportStagingCleanupManagerOptions) {
    this.staging = options.staging;
    this.ttlMs = options.ttlMs ?? DEFAULT_IMPORT_STAGING_TTL_HOURS * 60 * 60 * 1000;
    this.intervalMs = options.intervalMs ?? DEFAULT_IMPORT_STAGING_CLEANUP_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0) throw new Error('TTL de staging inválido.');
    if (!Number.isFinite(this.intervalMs) || this.intervalMs <= 0) throw new Error('Intervalo de cleanup inválido.');
  }

  async start() {
    const summary = await this.sweep('startup');
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.sweep('interval').catch(error => {
          this.logger?.warn(
            { err: error, component: 'import-staging-cleanup', reason: 'interval' },
            'Falha inesperada na varredura periódica do staging.'
          );
        });
      }, this.intervalMs);
      this.timer.unref?.();
    }
    return summary;
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  sweep(reason: CleanupReason = 'manual') {
    if (this.sweepPromise) return this.sweepPromise;
    this.sweepPromise = this.runSweep(reason).finally(() => {
      this.sweepPromise = null;
    });
    return this.sweepPromise;
  }

  private async runSweep(reason: CleanupReason): Promise<ImportStagingCleanupSummary> {
    const snapshot = await this.staging.cleanupSnapshot();
    const active = new Set(snapshot.activeWorkspaces.map(workspace => path.resolve(workspace.directory)));
    const names = await readdir(snapshot.stagingRoot).catch(error => {
      if (isMissing(error)) return [] as string[];
      throw error;
    });
    const summary = {
      reason,
      scanned: 0,
      removed: 0,
      skippedActive: 0,
      skippedFresh: 0,
      ignored: 0,
      failed: 0
    } satisfies ImportStagingCleanupSummary;

    for (const name of names) {
      if (!workspaceName(name)) {
        summary.ignored += 1;
        continue;
      }
      summary.scanned += 1;
      const candidatePath = path.join(snapshot.stagingRoot, name);
      const resolvedCandidate = path.resolve(candidatePath);
      if (!isPathInside(snapshot.stagingRoot, resolvedCandidate) || isPathInside(snapshot.musicRoot, resolvedCandidate)) {
        summary.failed += 1;
        this.logger?.warn(
          { component: 'import-staging-cleanup', reason, workspace: name },
          'Workspace de staging recusado por confinamento.'
        );
        continue;
      }
      if (active.has(resolvedCandidate)) {
        summary.skippedActive += 1;
        continue;
      }

      try {
        const entry = await lstat(candidatePath);
        const isDirectory = entry.isDirectory() && !entry.isSymbolicLink();
        if (isDirectory) {
          const realCandidate = await realpath(candidatePath);
          if (!isPathInside(snapshot.stagingRoot, realCandidate) || isPathInside(snapshot.musicRoot, realCandidate)) {
            throw new Error('Workspace resolveu para fora da raiz segura de staging.');
          }
        }
        const activity = await lastActivityMs(candidatePath, isDirectory);
        const ageMs = Math.max(0, this.now() - activity);
        if (ageMs < this.ttlMs) {
          summary.skippedFresh += 1;
          continue;
        }

        const latestEntry = await lstat(candidatePath);
        if (latestEntry.isSymbolicLink() || !latestEntry.isDirectory()) {
          await unlink(candidatePath);
        } else {
          await rm(candidatePath, { recursive: true, force: true });
        }
        summary.removed += 1;
        this.logger?.info(
          { component: 'import-staging-cleanup', reason, workspace: name, ageMs },
          'Workspace órfão de staging removido.'
        );
      } catch (error) {
        if (isMissing(error)) continue;
        summary.failed += 1;
        this.logger?.warn(
          { err: error, component: 'import-staging-cleanup', reason, workspace: name },
          'Falha ao remover workspace órfão de staging.'
        );
      }
    }

    this.logger?.info(
      {
        component: 'import-staging-cleanup',
        ttlMs: this.ttlMs,
        ...summary
      },
      'Varredura do staging de importações concluída.'
    );
    return summary;
  }
}
