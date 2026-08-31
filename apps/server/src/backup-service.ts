import {
  BackupValidationError,
  RestoreRollbackError,
  createBackupArtifact,
  restoreBackupArtifact,
  verifyBackupArtifact
} from './backup-restore.js';

export { BackupValidationError, RestoreRollbackError } from './backup-restore.js';

type BackupServiceOptions = {
  databasePath: string;
  defaultOutputRoot: string;
  env: NodeJS.ProcessEnv;
  restoreOfflineBlocker: (databasePath: string) => Promise<string | null>;
};

type VerifiedBackupArtifact = Awaited<ReturnType<typeof verifyBackupArtifact>>;

type BackupRestoreHooks = {
  onVerified?: (verified: VerifiedBackupArtifact) => Promise<void> | void;
};

export class BackupService {
  constructor(private readonly options: BackupServiceOptions) {}

  create(outputRoot?: string | null) {
    return createBackupArtifact({
      databasePath: this.options.databasePath,
      outputRoot: outputRoot || this.options.defaultOutputRoot,
      env: this.options.env
    });
  }

  verify(artifactPath: string) {
    return verifyBackupArtifact(artifactPath);
  }

  async restore(artifactPath: string, hooks: BackupRestoreHooks = {}) {
    const initialBlocker = await this.options.restoreOfflineBlocker(this.options.databasePath);
    if (initialBlocker) {
      return {
        blocked: initialBlocker,
        verified: null,
        restored: null
      } as const;
    }

    const verified = await verifyBackupArtifact(artifactPath);
    await hooks.onVerified?.(verified);
    const restored = await restoreBackupArtifact(
      artifactPath,
      this.options.databasePath,
      {
        beforeReplace: async () => {
          const blocker = await this.options.restoreOfflineBlocker(this.options.databasePath);
          if (blocker) throw new BackupValidationError(blocker);
        }
      }
    );

    return {
      blocked: null,
      verified,
      restored
    } as const;
  }
}

export function backupServiceErrorMessage(error: unknown) {
  if (error instanceof RestoreRollbackError) return error.message;
  if (error instanceof BackupValidationError) return error.message;
  return error instanceof Error ? error.message : 'erro desconhecido';
}
