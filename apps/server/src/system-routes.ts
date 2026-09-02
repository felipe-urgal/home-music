import type { FastifyInstance } from 'fastify';
import type { FfmpegStatus } from './ffmpeg.js';
import type { HeavyWorkQueueRuntime } from './heavy-work-queue.js';
import type { LibraryService } from './library-service.js';
import {
  requestPathname,
  sendWebRequest,
  type PreparedWebApp
} from './static-web.js';
import { TRANSCODE_PROFILES } from './transcoding.js';

type HeavyWorkRuntime = {
  transcode: HeavyWorkQueueRuntime;
  cover: HeavyWorkQueueRuntime;
  imports: HeavyWorkQueueRuntime;
  integrity: HeavyWorkQueueRuntime;
};

type SystemRouteDependencies = {
  isProduction: boolean;
  musicDirConfigured: boolean;
  authConfigured: boolean;
  transcodeCacheMegabytes: number;
  library: LibraryService;
  getFfmpegStatus: () => FfmpegStatus;
  getSchemaVersion: () => number;
  getTranscodingRuntime: () => { active: number; pending: number };
  getHeavyWorkRuntime?: () => HeavyWorkRuntime;
  isWebReady: () => boolean;
};

export function registerSystemRoutes(
  app: FastifyInstance,
  dependencies: SystemRouteDependencies
) {
  const {
    isProduction,
    musicDirConfigured,
    authConfigured,
    transcodeCacheMegabytes,
    library,
    getFfmpegStatus,
    getSchemaVersion,
    getTranscodingRuntime,
    getHeavyWorkRuntime,
    isWebReady
  } = dependencies;

  const readinessState = () => {
    const webReady = !isProduction || isWebReady();
    return {
      ready: webReady && authConfigured && library.ready,
      webReady
    };
  };

  app.get('/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });

  app.get('/ready', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { ready } = readinessState();
    return reply.code(ready ? 200 : 503).send({ ready });
  });

  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const { ready, webReady } = readinessState();
    const ffmpegStatus = getFfmpegStatus();
    const transcoding = getTranscodingRuntime();
    const workQueues = getHeavyWorkRuntime?.();
    return {
      ready,
      mode: isProduction ? 'production' : 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      webReady,
      libraryReady: library.ready,
      tracks: library.enabledTrackCount,
      ...library.status(),
      musicDirConfigured,
      authConfigured,
      ffmpeg: {
        available: ffmpegStatus.available,
        version: ffmpegStatus.version,
        customPath: ffmpegStatus.customCommand,
        issue: ffmpegStatus.issue
      },
      transcoding: {
        available: ffmpegStatus.available,
        profiles: ffmpegStatus.available ? Object.keys(TRANSCODE_PROFILES) : [],
        cacheLimitMegabytes: transcodeCacheMegabytes,
        active: transcoding.active,
        pending: transcoding.pending,
        ...(workQueues ? {
          rejected: workQueues.transcode.rejected,
          oldestPendingMs: workQueues.transcode.oldestPendingMs,
          lastQueueWaitMs: workQueues.transcode.lastQueueWaitMs
        } : {})
      },
      ...(workQueues ? { workQueues } : {}),
      schemaVersion: getSchemaVersion()
    };
  });
}

export function registerStaticWebRoutes(app: FastifyInstance, webApp: PreparedWebApp) {
  app.get('/*', async (request, reply) => {
    const pathname = requestPathname(request.url);
    if (!pathname) return reply.code(400).send({ error: 'URL inválida.' });
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Rota da API não encontrada.' });
    }
    return sendWebRequest(reply, webApp, request.url);
  });
}