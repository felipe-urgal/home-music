import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import { registerAdminOperationHistoryRoutes } from './admin-operation-history-routes.js';
import { registerAdminTranscodeCacheRoutes } from './admin-transcode-cache-routes.js';
import { registerAdminTrackRoutes } from './admin-track-routes.js';
import { registerAdminUserRoutes } from './admin-user-routes.js';
import {
  DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS,
  parseAutoRescanIntervalSeconds,
  startAutoRescanScheduler
} from './auto-rescan.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { registerAuthRoutes } from './auth-routes.js';
import { probeFfmpeg, resolveFfmpegCommand, type FfmpegStatus } from './ffmpeg.js';
import { registerLibraryRoutes } from './library-routes.js';
import { LibraryService } from './library-service.js';
import { registerMediaRoutes } from './media-routes.js';
import { registerPersonalRoutes } from './personal-routes.js';
import { createServerInfrastructure } from './server-infrastructure.js';
import { prepareWebApp, type PreparedWebApp } from './static-web.js';
import { registerStaticWebRoutes, registerSystemRoutes } from './system-routes.js';
import { TrackMediaInfrastructure } from './track-media-infrastructure.js';
import {
  DEFAULT_TRANSCODE_CACHE_MEGABYTES,
  parseTranscodeCacheMegabytes
} from './transcoding.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const defaultTranscodeCachePath = fileURLToPath(new URL('../../../data/transcode-cache/', import.meta.url));
const webDistPath = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const productionCsp = "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

config({ path: rootEnvPath });

const databasePath = process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  await import('./bootstrap-preload.js');
}

const app = Fastify({
  logger: true,
  bodyLimit: 256 * 1024
});

let autoRescanIntervalSeconds = DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS;
try {
  autoRescanIntervalSeconds = parseAutoRescanIntervalSeconds(
    process.env.HOME_MUSIC_RESCAN_INTERVAL_SECONDS
  );
} catch (error) {
  app.log.warn(
    { err: error, fallbackSeconds: DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS },
    'Intervalo de rescan automático inválido; usando o valor padrão.'
  );
}

let transcodeCacheMegabytes = DEFAULT_TRANSCODE_CACHE_MEGABYTES;
try {
  transcodeCacheMegabytes = parseTranscodeCacheMegabytes(
    process.env.HOME_MUSIC_TRANSCODE_CACHE_MB
  );
} catch (error) {
  app.log.warn(
    { err: error, fallbackMegabytes: DEFAULT_TRANSCODE_CACHE_MEGABYTES },
    'Limite do cache de transcoding inválido; usando o valor padrão.'
  );
}

const musicDir = process.env.MUSIC_DIR || '';
const port = Number(process.env.PORT || 8787);
const host = isProduction
  ? process.env.PRODUCTION_HOST || '0.0.0.0'
  : process.env.HOST || '127.0.0.1';
const forceSecureCookie = process.env.HOME_MUSIC_COOKIE_SECURE === 'true';
const trustTailscaleForwardedFor = process.env.HOME_MUSIC_TRUST_TAILSCALE_PROXY === 'true'
  && isProduction
  && host === '127.0.0.1'
  && forceSecureCookie;
const ffmpegPathConfig = process.env.HOME_MUSIC_FFMPEG_PATH;
let ffmpegCommand = 'ffmpeg';
try {
  ffmpegCommand = resolveFfmpegCommand(ffmpegPathConfig);
} catch {
  // O probe transforma configuração inválida em status não disponível.
}

const infrastructure = createServerInfrastructure({
  databasePath,
  transcodeCachePath: defaultTranscodeCachePath,
  ffmpegCommand,
  transcodeCacheMegabytes,
  logger: app.log
});
const library = new LibraryService({
  musicDir,
  autoRescanIntervalSeconds,
  database: infrastructure.database,
  trackAvailability: infrastructure.trackAvailability,
  operationHistory: infrastructure.operationHistory,
  logger: app.log
});
let ffmpegStatus: FfmpegStatus = {
  available: false,
  version: null,
  issue: null,
  customCommand: Boolean(ffmpegPathConfig?.trim())
};
const media = new TrackMediaInfrastructure({
  library,
  transcodeManager: infrastructure.transcodeManager,
  transcodeCacheMaintenance: infrastructure.transcodeCacheMaintenance,
  getFfmpegStatus: () => ffmpegStatus
});
library.setMediaCacheInvalidator(() => media.clearCoverCache());

let webApp: PreparedWebApp | null = null;
let stopAutoRescan: (() => void) | null = null;
let shuttingDown = false;

function stopAutomaticRescan() {
  stopAutoRescan?.();
  stopAutoRescan = null;
}

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  if (isProduction) reply.header('Content-Security-Policy', productionCsp);
  return payload;
});

installApiAuthPolicy(app, {
  configured: infrastructure.authConfigured,
  sessions: infrastructure.sessions,
  users: infrastructure.authUsers
});

registerAuthRoutes(app, {
  authConfigured: infrastructure.authConfigured,
  authUsers: infrastructure.authUsers,
  sessions: infrastructure.sessions,
  accountPasswords: infrastructure.accountPasswords,
  loginRateLimiter: infrastructure.loginRateLimiter,
  forceSecureCookie,
  trustTailscaleForwardedFor
});
registerAdminUserRoutes(app, infrastructure.adminUsers);
registerAdminImportRoutes(app, infrastructure.importJobs, {
  onPromoted: (promoted, jobId) => library.updateForPromotedImport(promoted, jobId)
});
registerAdminOperationHistoryRoutes(app, infrastructure.operationHistory);
registerAdminTranscodeCacheRoutes(app, infrastructure.transcodeCacheMaintenance);
registerAdminTrackRoutes(app, {
  listTracks: () => library.listAdminTracks(),
  setEnabled: (trackId, enabled) => library.setTrackEnabled(trackId, enabled),
  setLocation: (trackId, location) => library.setTrackLocation(trackId, location)
}, {
  databasePath,
  musicDir
});
registerLibraryRoutes(app, library);
registerPersonalRoutes(app, infrastructure.database, library);
registerMediaRoutes(app, library, media);
registerSystemRoutes(app, {
  isProduction,
  musicDirConfigured: Boolean(musicDir),
  transcodeCacheMegabytes,
  infrastructure,
  library,
  getFfmpegStatus: () => ffmpegStatus,
  isWebReady: () => Boolean(webApp)
});

app.addHook('onClose', async () => {
  stopAutomaticRescan();
  infrastructure.close();
});

app.setErrorHandler((error, request, reply) => {
  app.log.error({ err: error, method: request.method, url: request.url }, 'Erro não tratado no servidor');
  if (!reply.sent) reply.code(500).send({ error: 'Erro interno do servidor.' });
});

async function shutdown(signal: 'SIGINT' | 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAutomaticRescan();
  app.log.info({ signal }, 'Encerrando Home Music');

  const timeout = setTimeout(() => {
    app.log.error('Timeout no shutdown; encerrando o processo.');
    process.exit(1);
  }, 25_000);
  timeout.unref();

  try {
    if (library.scanning) {
      app.log.info('Aguardando scan em andamento antes de fechar o SQLite');
      try {
        await library.waitForCurrentScan();
      } catch {
        // O erro original do scan já será registrado/tratado pelo fluxo chamador.
      }
    }
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Falha ao encerrar o servidor corretamente');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

if (isProduction) {
  try {
    webApp = await prepareWebApp(webDistPath);
  } catch (error) {
    app.log.error(
      { err: error, webDistPath },
      'Frontend de produção não encontrado. Execute npm run build antes de npm start.'
    );
    await app.close();
    throw error;
  }
  registerStaticWebRoutes(app, webApp);
}

try {
  await library.initialize();
} catch (error) {
  app.log.warn({ err: error }, 'Biblioteca ainda não pôde ser carregada. Verifique MUSIC_DIR.');
}

ffmpegStatus = await probeFfmpeg(ffmpegPathConfig);
if (ffmpegStatus.available) {
  app.log.info(
    {
      version: ffmpegStatus.version,
      customPath: ffmpegStatus.customCommand,
      transcodeCacheMegabytes
    },
    'FFmpeg disponível para transcoding adaptativo.'
  );
} else {
  app.log.warn(
    { issue: ffmpegStatus.issue, customPath: ffmpegStatus.customCommand },
    'FFmpeg indisponível; o streaming direto continua funcionando normalmente.'
  );
}

if (!shuttingDown) {
  await app.listen({ port, host });

  if (musicDir && autoRescanIntervalSeconds > 0) {
    const intervalMs = autoRescanIntervalSeconds * 1000;
    stopAutoRescan = startAutoRescanScheduler({
      intervalMs,
      initialDelayMs: 15_000,
      run: async () => {
        const result = await library.rescan('automatic');
        if (result.added > 0 || result.updated > 0 || result.removed > 0) {
          app.log.info(
            {
              added: result.added,
              updated: result.updated,
              removed: result.removed,
              tracks: result.tracks
            },
            'Biblioteca atualizada automaticamente.'
          );
        }
      },
      onError: error => {
        app.log.warn(
          { err: error },
          'Rescan automático falhou; uma nova tentativa será feita no próximo intervalo.'
        );
      }
    });
    app.log.info(
      { intervalSeconds: autoRescanIntervalSeconds, initialDelaySeconds: 15 },
      'Rescan automático da biblioteca habilitado.'
    );
  }
}
