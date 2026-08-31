import type { FastifyInstance } from 'fastify';
import type { FfmpegStatus } from './ffmpeg.js';
import type { LibraryService } from './library-service.js';
import type { ServerInfrastructure } from './server-infrastructure.js';
import {
  requestPathname,
  sendWebRequest,
  type PreparedWebApp
} from './static-web.js';
import { TRANSCODE_PROFILES } from './transcoding.js';

type SystemRouteDependencies = {
  isProduction: boolean;
  musicDirConfigured: boolean;
  transcodeCacheMegabytes: number;
  infrastructure: ServerInfrastructure;
  library: LibraryService;
  getFfmpegStatus: () => FfmpegStatus;
  isWebReady: () => boolean;
};

export function registerSystemRoutes(
  app: FastifyInstance,
  dependencies: SystemRouteDependencies
) {
  const {
    isProduction,
    musicDirConfigured,
    transcodeCacheMegabytes,
    infrastructure,
    library,
    getFfmpegStatus,
    isWebReady
  } = dependencies;

  const readinessState = () => {
    const webReady = !isProduction || isWebReady();
    return {
      ready: webReady && infrastructure.authConfigured && library.ready,
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
    return {
      ready,
      mode: isProduction ? 'production' : 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      webReady,
      libraryReady: library.ready,
      tracks: library.enabledTrackCount,
      ...library.status(),
      musicDirConfigured,
      authConfigured: infrastructure.authConfigured,
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
        active: infrastructure.transcodeManager.activeCount,
        pending: infrastructure.transcodeManager.pendingCount
      },
      schemaVersion: infrastructure.database.getSchemaVersion()
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
