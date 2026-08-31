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

  async restore(artifactPath: string) {
    const initialBlocker = await this.options.restoreOfflineBlocker(this.options.databasePath);
    if (initialBlocker) throw new BackupValidationError(initialBlocker);

    const verified = await verifyBackupArtifact(artifactPath);
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

    return { verified, restored };
  }
}

export function backupServiceErrorMessage(error: unknown) {
  if (error instanceof RestoreRollbackError) return error.message;
  if (error instanceof BackupValidationError) return error.message;
  return error instanceof Error ? error.message : 'erro desconhecido';
}
