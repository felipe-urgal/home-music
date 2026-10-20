import type { FastifyBaseLogger } from 'fastify';
import { AccountPasswordService } from './account-password.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { AdminUsersService } from './admin-users.js';
import { HomeMusicDatabase } from './database.js';
import {
  DEFAULT_HEAVY_WORK_LIMITS,
  type HeavyWorkLimits
} from './heavy-work-queue.js';
import { ImportJobQueue } from './import-job-queue.js';
import {
  DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG,
  LoginAbuseProtection,
  parseLoginAbuseProtectionConfig,
  type LoginAbuseProtectionConfig
} from './login-abuse-protection.js';
import { LongJobObservability } from './long-job-observability.js';
import { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { PersistentSessionManager } from './persistent-session-manager.js';
import { TrackAvailabilityStore } from './track-availability-store.js';
import { TranscodeCacheMaintenance } from './transcode-cache-maintenance.js';
import { TranscodeManager } from './transcoding.js';
import { UserAuthStore } from './user-auth-store.js';

type ServerInfrastructureOptions = {
  databasePath: string;
  transcodeCachePath: string;
  ffmpegCommand: string;
  transcodeCacheMegabytes: number;
  loginAbuseProtectionConfig?: LoginAbuseProtectionConfig;
  heavyWorkLimits?: HeavyWorkLimits;
  logger: FastifyBaseLogger;
};

function resolveLoginAbuseProtectionConfig(options: ServerInfrastructureOptions) {
  if (options.loginAbuseProtectionConfig) return options.loginAbuseProtectionConfig;
  try {
    return parseLoginAbuseProtectionConfig(process.env);
  } catch (error) {
    options.logger.warn(
      { err: error },
      'Configuração de proteção do login inválida; usando limites seguros padrão.'
    );
    return DEFAULT_LOGIN_ABUSE_PROTECTION_CONFIG;
  }
}

export function createServerInfrastructure(options: ServerInfrastructureOptions) {
  // Only the composition root owns these long-lived SQLite connections.
  // A partial startup must release every successfully constructed store.
  const ownedStores: Array<{ close(): void }> = [];
  const own = <T extends { close(): void }>(store: T): T => {
    ownedStores.push(store);
    return store;
  };
  const closeOwnedStores = () => {
    let failure: unknown;
    let hasFailure = false;
    // Release in reverse construction order, even when an individual close throws.
    while (ownedStores.length > 0) {
      try {
        ownedStores.pop()!.close();
      } catch (error) {
        if (!hasFailure) {
          failure = error;
          hasFailure = true;
        }
      }
    }
    if (hasFailure) throw failure;
  };

  try {
  const heavyWorkLimits = options.heavyWorkLimits ?? DEFAULT_HEAVY_WORK_LIMITS;
  const database = own(new HomeMusicDatabase(options.databasePath));
  const trackAvailability = own(new TrackAvailabilityStore(options.databasePath));
  const authUsers = own(new UserAuthStore(options.databasePath));
  const openSubsonicCredentials = own(new OpenSubsonicCredentialStore(options.databasePath));
  const sessions = own(new PersistentSessionManager(options.databasePath));
  const accountPasswords = own(new AccountPasswordService(options.databasePath, sessions));
  const adminUsers = own(new AdminUsersService(options.databasePath, sessions));
  const operationHistory = own(new AdminOperationHistoryStore(options.databasePath));
  const longJobObservability = new LongJobObservability(options.logger);
  const importJobs = new ImportJobQueue({
    maxNonTerminalJobs: heavyWorkLimits.imports.maxNonTerminal,
    maxNonTerminalJobsPerOwner: heavyWorkLimits.imports.maxNonTerminalPerOwner,
    retryAfterSeconds: heavyWorkLimits.retryAfterSeconds,
    onChange: job => {
      let operationId: string | null = null;
      try {
        operationHistory.recordImport(job);
        operationId = `import-${job.id}`;
      } catch (error) {
        options.logger.warn(
          { err: error, importJobId: job.id },
          'Falha ao persistir histórico da importação.'
        );
      }
      longJobObservability.observeImportJob(job, operationId);
    }
  });
  const loginAbuseProtection = new LoginAbuseProtection(resolveLoginAbuseProtectionConfig(options));
  const transcodeManager = new TranscodeManager({
    cacheDir: options.transcodeCachePath,
    command: options.ffmpegCommand,
    maxCacheBytes: options.transcodeCacheMegabytes * 1024 * 1024,
    maxConcurrent: heavyWorkLimits.transcode.maxConcurrent,
    maxPending: heavyWorkLimits.transcode.maxPending,
    maxPendingPerOwner: heavyWorkLimits.transcode.maxPendingPerOwner,
    retryAfterSeconds: heavyWorkLimits.retryAfterSeconds,
    observability: longJobObservability
  });
  const transcodeCacheMaintenance = new TranscodeCacheMaintenance({
    cacheDir: options.transcodeCachePath,
    limitBytes: transcodeManager.maxCacheBytes,
    retryAfterSeconds: heavyWorkLimits.retryAfterSeconds,
    runtime: () => ({
      active: transcodeManager.activeCount,
      pending: transcodeManager.pendingCount
    })
  });

  return {
    database,
    trackAvailability,
    authUsers,
    openSubsonicCredentials,
    sessions,
    accountPasswords,
    adminUsers,
    operationHistory,
    longJobObservability,
    importJobs,
    loginAbuseProtection,
    transcodeManager,
    transcodeCacheMaintenance,
    heavyWorkLimits,
    authConfigured: authUsers.isConfigured(),
    close: closeOwnedStores
  };
  } catch (error) {
    try {
      closeOwnedStores();
    } catch {
      // Preserve the initialization failure; all registered stores were attempted.
    }
    throw error;
  }
}

export type ServerInfrastructure = ReturnType<typeof createServerInfrastructure>;
