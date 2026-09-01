import type { FastifyBaseLogger } from 'fastify';
import { AccountPasswordService } from './account-password.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { AdminUsersService } from './admin-users.js';
import {
  LoginRateLimiter,
  SESSION_TTL_SECONDS,
  SessionManager
} from './auth.js';
import { HomeMusicDatabase } from './database.js';
import { ImportJobQueue } from './import-job-queue.js';
import { LongJobObservability } from './long-job-observability.js';
import { TrackAvailabilityStore } from './track-availability-store.js';
import { TranscodeCacheMaintenance } from './transcode-cache-maintenance.js';
import { TranscodeManager } from './transcoding.js';
import { UserAuthStore } from './user-auth-store.js';

type ServerInfrastructureOptions = {
  databasePath: string;
  transcodeCachePath: string;
  ffmpegCommand: string;
  transcodeCacheMegabytes: number;
  logger: FastifyBaseLogger;
};

export function createServerInfrastructure(options: ServerInfrastructureOptions) {
  const database = new HomeMusicDatabase(options.databasePath);
  const trackAvailability = new TrackAvailabilityStore(options.databasePath);
  const authUsers = new UserAuthStore(options.databasePath);
  const sessions = new SessionManager('', '', SESSION_TTL_SECONDS * 1000, 128, { status: 'blocked' });
  const accountPasswords = new AccountPasswordService(options.databasePath, sessions);
  const adminUsers = new AdminUsersService(options.databasePath, sessions);
  const operationHistory = new AdminOperationHistoryStore(options.databasePath);
  const longJobObservability = new LongJobObservability(options.logger);
  const importJobs = new ImportJobQueue({
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
  const loginRateLimiter = new LoginRateLimiter();
  const transcodeManager = new TranscodeManager({
    cacheDir: options.transcodeCachePath,
    command: options.ffmpegCommand,
    maxCacheBytes: options.transcodeCacheMegabytes * 1024 * 1024,
    maxConcurrent: 1,
    observability: longJobObservability
  });
  const transcodeCacheMaintenance = new TranscodeCacheMaintenance({
    cacheDir: options.transcodeCachePath,
    limitBytes: transcodeManager.maxCacheBytes,
    runtime: () => ({
      active: transcodeManager.activeCount,
      pending: transcodeManager.pendingCount
    })
  });

  return {
    database,
    trackAvailability,
    authUsers,
    sessions,
    accountPasswords,
    adminUsers,
    operationHistory,
    longJobObservability,
    importJobs,
    loginRateLimiter,
    transcodeManager,
    transcodeCacheMaintenance,
    authConfigured: authUsers.isConfigured(),
    close() {
      accountPasswords.close();
      adminUsers.close();
      operationHistory.close();
      authUsers.close();
      trackAvailability.close();
      database.close();
    }
  };
}

export type ServerInfrastructure = ReturnType<typeof createServerInfrastructure>;
