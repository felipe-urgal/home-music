import { config } from 'dotenv';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { AdminScanTrigger, NormalizationMode, PlaybackState, RepeatMode, ScanResponse } from '@home-music/shared';
import {
  ACCOUNT_PASSWORD_MIN_LENGTH,
  AccountPasswordService
} from './account-password.js';
import { registerAccountSessionRoutes } from './account-session-routes.js';
import { registerAdminImportRoutes } from './admin-import-routes.js';
import { buildAdminLibraryOverview } from './admin-library-overview.js';
import { registerAdminOperationHistoryRoutes } from './admin-operation-history-routes.js';
import { runScanWithHistory } from './admin-operation-history-scan.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { registerAdminTranscodeCacheRoutes } from './admin-transcode-cache-routes.js';
import { registerAdminTrackRoutes } from './admin-track-routes.js';
import {
  DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS,
  parseAutoRescanIntervalSeconds,
  startAutoRescanScheduler
} from './auto-rescan.js';
import { registerAdminUserRoutes } from './admin-user-routes.js';
import { AdminUsersService } from './admin-users.js';
import {
  buildSessionCookie,
  loginRateLimitKey,
  LoginRateLimiter,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SessionManager
} from './auth.js';
import { resolveAuthStatus } from './auth-status.js';
import { installApiAuthPolicy } from './auth-policy.js';
import { HomeMusicDatabase } from './database.js';
import { probeFfmpeg, resolveFfmpegCommand, type FfmpegStatus } from './ffmpeg.js';
import { ImportJobQueue } from './import-job-queue.js';
import { readCover, scanLibrary, type IndexedTrack } from './library.js';
import { replayGainForMode } from './replay-gain.js';
import { readTrackLyrics } from './lyrics.js';
import {
  openRegularFileInside,
  parseByteRange,
  resolveLibraryRoot,
  UnsafeLibraryPathError
} from './security.js';
import {
  prepareWebApp,
  requestPathname,
  sendWebRequest,
  type PreparedWebApp
} from './static-web.js';
import { TrackAvailabilityStore } from './track-availability-store.js';
import { TranscodeCacheMaintenance } from './transcode-cache-maintenance.js';
import {
  DEFAULT_TRANSCODE_CACHE_MEGABYTES,
  parseTranscodeCacheMegabytes,
  parseTranscodeQuality,
  TRANSCODE_PROFILES,
  TranscodeExecutionError,
  TranscodeManager
} from './transcoding.js';
import { UserAuthStore } from './user-auth-store.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const defaultTranscodeCachePath = fileURLToPath(new URL('../../../data/transcode-cache/', import.meta.url));
const webDistPath = fileURLToPath(new URL('../../web/dist/', import.meta.url));
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
  autoRescanIntervalSeconds = parseAutoRescanIntervalSeconds(process.env.HOME_MUSIC_RESCAN_INTERVAL_SECONDS);
} catch (error) {
  app.log.warn(
    { err: error, fallbackSeconds: DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS },
    'Intervalo de rescan automático inválido; usando o valor padrão.'
  );
}

let transcodeCacheMegabytes = DEFAULT_TRANSCODE_CACHE_MEGABYTES;
try {
  transcodeCacheMegabytes = parseTranscodeCacheMegabytes(process.env.HOME_MUSIC_TRANSCODE_CACHE_MB);
} catch (error) {
  app.log.warn(
    { err: error, fallbackMegabytes: DEFAULT_TRANSCODE_CACHE_MEGABYTES },
    'Limite do cache de transcoding inválido; usando o valor padrão.'
  );
}

const database = new HomeMusicDatabase(databasePath);
const trackAvailability = new TrackAvailabilityStore(databasePath);
const authUsers = new UserAuthStore(databasePath);
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
  // O probe abaixo transforma configuração inválida em status não disponível.
}
const sessions = new SessionManager('', '', SESSION_TTL_SECONDS * 1000, 128, { status: 'blocked' });
const accountPasswords = new AccountPasswordService(databasePath, sessions);
const adminUsers = new AdminUsersService(databasePath, sessions);
const operationHistory = new AdminOperationHistoryStore(databasePath);
const importJobs = new ImportJobQueue({
  onChange: job => {
    try {
      operationHistory.recordImport(job);
    } catch (error) {
      app.log.warn({ err: error, importJobId: job.id }, 'Falha ao persistir histórico da importação.');
    }
  }
});
const loginRateLimiter = new LoginRateLimiter();
const authConfigured = authUsers.isConfigured();
const productionCsp = "default-src 'self'; img-src 'self' data: blob:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const transcodeManager = new TranscodeManager({
  cacheDir: defaultTranscodeCachePath,
  command: ffmpegCommand,
  maxCacheBytes: transcodeCacheMegabytes * 1024 * 1024,
  maxConcurrent: 1
});
const transcodeCacheMaintenance = new TranscodeCacheMaintenance({
  cacheDir: defaultTranscodeCachePath,
  limitBytes: transcodeManager.maxCacheBytes,
  runtime: () => ({
    active: transcodeManager.activeCount,
    pending: transcodeManager.pendingCount
  })
});

let tracks: IndexedTrack[] = [];
let tracksById = new Map<string, IndexedTrack>();
let libraryRoot = '';
let libraryReady = false;
let libraryRevision = 0;
let scannedAt = new Date(0).toISOString();
let scanPromise: Promise<ScanResponse> | null = null;
let stopAutoRescan: (() => void) | null = null;
let webApp: PreparedWebApp | null = null;
let shuttingDown = false;
let ffmpegStatus: FfmpegStatus = {
  available: false,
  version: null,
  issue: null,
  customCommand: Boolean(ffmpegPathConfig?.trim())
};

const MAX_COVER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_COVER_CACHE_ITEMS = 64;
const MAX_CONCURRENT_COVER_REQUESTS = 4;
let coverCacheBytes = 0;
let activeCoverRequests = 0;
const coverWaiters: Array<() => void> = [];

type CachedCover = {
  data: Buffer;
  format: string;
  size: number;
  mtimeMs: number;
};

const coverCache = new Map<string, CachedCover>();

function setTracks(nextTracks: IndexedTrack[]) {
  tracks = nextTracks;
  tracksById = new Map(
    nextTracks
      .filter(track => trackAvailability.isEnabled(track.id))
      .map(track => [track.id, track])
  );
}

function publicTrack(track: IndexedTrack) {
  const {
    filePath: _filePath,
    mimeType: _mimeType,
    fileSize: _fileSize,
    mtimeMs: _mtimeMs,
    ...safe
  } = track;
  return safe;
}

function clearCoverCache() {
  coverCache.clear();
  coverCacheBytes = 0;
}

function automaticRescanStatus() {
  const enabled = Boolean(musicDir) && autoRescanIntervalSeconds > 0;
  return {
    enabled,
    intervalSeconds: enabled ? autoRescanIntervalSeconds : null
  };
}

function libraryStatus() {
  return {
    scannedAt,
    scanning: Boolean(scanPromise),
    revision: libraryRevision,
    autoRescan: automaticRescanStatus()
  };
}

function stopAutomaticRescan() {
  stopAutoRescan?.();
  stopAutoRescan = null;
}

async function withCoverRequestSlot<T>(operation: () => Promise<T>) {
  if (activeCoverRequests >= MAX_CONCURRENT_COVER_REQUESTS) {
    await new Promise<void>(resolve => coverWaiters.push(resolve));
  }

  activeCoverRequests += 1;
  try {
    return await operation();
  } finally {
    activeCoverRequests -= 1;
    coverWaiters.shift()?.();
  }
}

function getCachedCover(trackId: string, size: number, mtimeMs: number) {
  const cached = coverCache.get(trackId);
  if (!cached || cached.size !== size || cached.mtimeMs !== mtimeMs) {
    if (cached) {
      coverCacheBytes -= cached.data.byteLength;
      coverCache.delete(trackId);
    }
    return undefined;
  }

  coverCache.delete(trackId);
  coverCache.set(trackId, cached);
  return cached;
}

function cacheCover(trackId: string, cover: CachedCover) {
  if (cover.data.byteLength > MAX_COVER_CACHE_BYTES) return;

  const previous = coverCache.get(trackId);
  if (previous) coverCacheBytes -= previous.data.byteLength;
  coverCache.delete(trackId);

  coverCache.set(trackId, cover);
  coverCacheBytes += cover.data.byteLength;

  while (coverCache.size > MAX_COVER_CACHE_ITEMS || coverCacheBytes > MAX_COVER_CACHE_BYTES) {
    const oldestKey = coverCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = coverCache.get(oldestKey);
    if (oldest) coverCacheBytes -= oldest.data.byteLength;
    coverCache.delete(oldestKey);
  }
}

async function performRescan(): Promise<ScanResponse> {
  if (!musicDir) {
    const hadTracks = tracks.length > 0;
    setTracks([]);
    libraryRoot = '';
    libraryReady = false;
    scannedAt = new Date().toISOString();
    if (hadTracks) {
      libraryRevision += 1;
      clearCoverCache();
    }
    return { tracks: 0, scannedAt, added: 0, updated: 0, removed: 0, unchanged: 0 };
  }

  const resolvedRoot = await resolveLibraryRoot(musicDir);
  const rootChanged = libraryRoot !== resolvedRoot;
  const previous = rootChanged ? [] : tracks;
  const result = await scanLibrary(resolvedRoot, previous, (message, error) => {
    app.log.warn({ err: error }, message);
  });
  const nextScannedAt = new Date().toISOString();
  const changed = rootChanged || result.stats.added > 0 || result.stats.updated > 0 || result.stats.removed > 0;

  database.syncTracks(result.tracks, resolvedRoot, nextScannedAt);
  trackAvailability.refresh();
  libraryRoot = resolvedRoot;
  scannedAt = nextScannedAt;
  setTracks(result.tracks);
  libraryReady = true;

  if (changed) {
    libraryRevision += 1;
    clearCoverCache();
  }

  return {
    tracks: tracksById.size,
    scannedAt,
    ...result.stats
  };
}

function rescan(trigger?: AdminScanTrigger) {
  if (scanPromise) return scanPromise;

  const run = trigger
    ? () => runScanWithHistory(
        operationHistory,
        trigger,
        performRescan,
        error => app.log.warn({ err: error, trigger }, 'Falha ao persistir histórico do scan.')
      )
    : performRescan;

  scanPromise = run()
    .catch(error => {
      libraryReady = false;
      throw error;
    })
    .finally(() => {
      scanPromise = null;
    });
  return scanPromise;
}

async function initializeLibrary() {
  if (!musicDir) {
    setTracks([]);
    libraryReady = false;
    return;
  }

  const resolvedRoot = await resolveLibraryRoot(musicDir);
  const storedRoot = database.getMetadata('libraryRoot');
  const storedScannedAt = database.getMetadata('scannedAt');

  if (storedRoot === resolvedRoot && storedScannedAt) {
    libraryRoot = resolvedRoot;
    scannedAt = storedScannedAt;
    setTracks(database.loadTracks());
    libraryReady = true;
    return;
  }

  await rescan();
}

function isNotFoundLike(error: unknown) {
  if (error instanceof UnsafeLibraryPathError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function cleanTrackIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string' && item.length <= 64)
    .filter(id => tracksById.has(id))
  )].slice(0, 5000);
}

function parseNormalizationMode(value: unknown): NormalizationMode | null {
  if (value == null || value === '' || value === 'off') return 'off';
  return value === 'track' || value === 'album' ? value : null;
}

function cleanRepeatMode(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off';
}

function requestPath(url: string) {
  return url.split('?', 1)[0];
}

function requestSessionToken(cookieHeader: string | undefined) {
  return readCookie(cookieHeader, SESSION_COOKIE_NAME);
}

function requestIsSecure(request: { protocol: string }) {
  return forceSecureCookie || request.protocol === 'https';
}

function readinessState() {
  const webReady = !isProduction || Boolean(webApp);
  return {
    ready: webReady && authConfigured && libraryReady,
    webReady
  };
}

installApiAuthPolicy(app, {
  configured: authConfigured,
  sessions,
  users: authUsers
});
registerAccountSessionRoutes(app, sessions);
registerAdminUserRoutes(app, adminUsers);
registerAdminImportRoutes(app, importJobs);
registerAdminOperationHistoryRoutes(app, operationHistory);
registerAdminTranscodeCacheRoutes(app, transcodeCacheMaintenance);
registerAdminTrackRoutes(app, {
  listTracks: () => tracks.map(track => ({
    ...publicTrack(track),
    enabled: trackAvailability.isEnabled(track.id)
  })),
  setEnabled: (trackId, enabled) => {
    const track = tracks.find(item => item.id === trackId);
    if (!track) return null;

    const currentEnabled = trackAvailability.isEnabled(trackId);
    if (currentEnabled !== enabled) {
      trackAvailability.setEnabled(trackId, enabled);
      setTracks(tracks);
      libraryRevision += 1;
      if (!enabled) clearCoverCache();
    }

    return { ...publicTrack(track), enabled };
  },
  setLocation: (trackId, location) => {
    const index = tracks.findIndex(item => item.id === trackId);
    if (index < 0) return null;

    const updated: IndexedTrack = {
      ...tracks[index],
      filePath: location.absolutePath,
      folder: location.folder,
      folderPath: location.folderPath
    };
    const nextTracks = [...tracks];
    nextTracks[index] = updated;
    setTracks(nextTracks);
    clearCoverCache();
    return {
      ...publicTrack(updated),
      enabled: trackAvailability.isEnabled(trackId)
    };
  }
});

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  if (isProduction) reply.header('Content-Security-Policy', productionCsp);
  return payload;
});

app.addHook('onClose', async () => {
  stopAutomaticRescan();
  accountPasswords.close();
  adminUsers.close();
  operationHistory.close();
  authUsers.close();
  trackAvailability.close();
  database.close();
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
    if (scanPromise) {
      app.log.info('Aguardando scan em andamento antes de fechar o SQLite');
      try {
        await scanPromise;
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
  return {
    ready,
    mode: isProduction ? 'production' : 'development',
    uptimeSeconds: Math.floor(process.uptime()),
    webReady,
    libraryReady,
    tracks: tracksById.size,
    ...libraryStatus(),
    musicDirConfigured: Boolean(musicDir),
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
      active: transcodeManager.activeCount,
      pending: transcodeManager.pendingCount
    },
    schemaVersion: database.getSchemaVersion()
  };
});

app.get('/api/admin/library/overview', async (_request, reply) => {
  reply.header('Cache-Control', 'private, no-store');
  return buildAdminLibraryOverview(tracks, {
    ready: libraryReady,
    scanning: Boolean(scanPromise),
    scannedAt,
    autoRescan: automaticRescanStatus()
  });
});

app.get('/api/auth/status', { config: { auth: 'public' } }, async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const token = requestSessionToken(request.headers.cookie);
  return resolveAuthStatus(authConfigured, token, sessions, authUsers);
});

app.post<{ Body: { username?: unknown; password?: unknown } }>(
  '/api/auth/login',
  { config: { auth: 'public' } },
  async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const key = loginRateLimitKey(
      request.raw.socket.remoteAddress || request.ip,
      request.headers['x-forwarded-for'],
      trustTailscaleForwardedFor
    );

    if (loginRateLimiter.isBlocked(key)) {
      reply.header('Retry-After', '300');
      return reply.code(429).send({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }

    const username = typeof request.body?.username === 'string' ? request.body.username : '';
    const password = typeof request.body?.password === 'string' ? request.body.password : '';
    const authenticated = await accountPasswords.authenticate(username, password);

    if (!authenticated) {
      loginRateLimiter.recordFailure(key);
      return reply.code(401).send({ error: 'Usuário ou senha inválidos.' });
    }

    loginRateLimiter.clear(key);
    const token = sessions.createSessionForUser(authenticated.userId);
    reply.header('Set-Cookie', buildSessionCookie(token, SESSION_TTL_SECONDS, requestIsSecure(request)));
    return {
      authenticated: true,
      passwordChangeRequired: authenticated.passwordMustChange
    };
  }
);

app.post<{ Body: { currentPassword?: unknown; newPassword?: unknown } }>(
  '/api/auth/password',
  async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!request.user) {
      return reply.code(409).send({ error: 'Troca de senha não está disponível para esta sessão.' });
    }

    const currentPassword = typeof request.body?.currentPassword === 'string'
      ? request.body.currentPassword
      : '';
    const newPassword = typeof request.body?.newPassword === 'string'
      ? request.body.newPassword
      : '';
    const result = await accountPasswords.changeAuthenticatedPassword(
      request.user.id,
      currentPassword,
      newPassword
    );

    if (!result.ok) {
      switch (result.error) {
        case 'invalid-current-password':
          return reply.code(400).send({ error: 'Senha atual inválida.' });
        case 'weak-new-password':
          return reply.code(400).send({
            error: `A nova senha deve ter pelo menos ${ACCOUNT_PASSWORD_MIN_LENGTH} caracteres.`
          });
        case 'same-password':
          return reply.code(400).send({ error: 'A nova senha precisa ser diferente da senha atual.' });
        case 'not-required':
          return reply.code(409).send({ error: 'Troca de senha não está disponível para esta conta.' });
        case 'stale-account':
          return reply.code(409).send({ error: 'A credencial da conta mudou durante a operação. Faça login novamente.' });
      }
    }

    reply.header('Set-Cookie', buildSessionCookie('', 0, requestIsSecure(request)));
    return { passwordChanged: true };
  }
);

app.post('/api/auth/logout', async (request, reply) => {
  const token = requestSessionToken(request.headers.cookie);
  sessions.revokeSession(token);
  reply.header('Set-Cookie', buildSessionCookie('', 0, requestIsSecure(request)));
  reply.header('Cache-Control', 'no-store');
  return reply.code(204).send();
});

app.get('/api/library', async (_request, reply) => {
  reply.header('Cache-Control', 'private, no-store');
  return {
    tracks: [...tracksById.values()].map(publicTrack),
    ...libraryStatus()
  };
});

app.get('/api/library/status', async (_request, reply) => {
  reply.header('Cache-Control', 'private, no-store');
  return libraryStatus();
});

app.post('/api/library/scan', async (_request, reply) => {
  const result = await rescan('manual');
  reply.header('Cache-Control', 'no-store');
  return result;
});

app.get('/api/favorites', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Favoritos pessoais exigem uma identidade persistida.' });
  }

  return { trackIds: database.getFavoriteIds(request.user.id) };
});

app.put<{ Params: { id: string }; Body: { favorite?: boolean } }>('/api/favorites/:id', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Favoritos pessoais exigem uma identidade persistida.' });
  }
  if (!tracksById.has(request.params.id)) return reply.code(404).send({ error: 'Música não encontrada.' });
  if (typeof request.body?.favorite !== 'boolean') return reply.code(400).send({ error: 'Valor de favorito inválido.' });

  database.setFavorite(request.user.id, request.params.id, request.body.favorite);
  return { favorite: request.body.favorite };
});

app.get('/api/playlists', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Playlists pessoais exigem uma identidade persistida.' });
  }

  return { playlists: database.getPlaylists(request.user.id) };
});

app.post<{ Body: { name?: string } }>('/api/playlists', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Playlists pessoais exigem uma identidade persistida.' });
  }

  const name = cleanName(request.body?.name);
  if (!name) return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });

  const id = database.createPlaylist(request.user.id, name);
  const playlist = database.getPlaylists(request.user.id).find(item => item.id === id);
  return reply.code(201).send({ playlist });
});

app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/playlists/:id', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Playlists pessoais exigem uma identidade persistida.' });
  }

  const source = database.getPlaylistSource(request.user.id, request.params.id);
  if (!source) return reply.code(404).send({ error: 'Playlist não encontrada.' });
  if (source !== 'manual') {
    return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
  }

  const name = cleanName(request.body?.name);
  if (!name) return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });
  if (!database.renamePlaylist(request.user.id, request.params.id)) {
    return reply.code(404).send({ error: 'Playlist não encontrada.' });
  }
  return { ok: true };
});

app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Playlists pessoais exigem uma identidade persistida.' });
  }

  const source = database.getPlaylistSource(request.user.id, request.params.id);
  if (!source) return reply.code(404).send({ error: 'Playlist não encontrada.' });
  if (source !== 'manual') {
    return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
  }

  if (!database.deletePlaylist(request.user.id, request.params.id)) {
    return reply.code(404).send({ error: 'Playlist não encontrada.' });
  }
  return reply.code(204).send();
});

app.put<{ Params: { id: string }; Body: { trackIds?: unknown } }>('/api/playlists/:id/tracks', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Playlists pessoais exigem uma identidade persistida.' });
  }

  const source = database.getPlaylistSource(request.user.id, request.params.id);
  if (!source) return reply.code(404).send({ error: 'Playlist não encontrada.' });
  if (source !== 'manual') {
    return reply.code(409).send({ error: 'Playlist importada é somente leitura.' });
  }
  if (!Array.isArray(request.body?.trackIds)) return reply.code(400).send({ error: 'Lista de músicas inválida.' });
  const trackIds = cleanTrackIds(request.body.trackIds);

  if (!database.setPlaylistTracks(request.user.id, request.params.id, trackIds)) {
    return reply.code(404).send({ error: 'Playlist não encontrada.' });
  }

  return { trackIds };
});

app.get('/api/player/state', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Estado do player exige uma identidade persistida.' });
  }

  reply.header('Cache-Control', 'private, no-store');
  return database.loadPlaybackState(request.user.id);
});

app.put<{ Body: Partial<PlaybackState> }>('/api/player/state', async (request, reply) => {
  if (!request.user) {
    return reply.code(409).send({ error: 'Estado do player exige uma identidade persistida.' });
  }

  const body = request.body ?? {};
  const currentTrackId = typeof body.currentTrackId === 'string' && tracksById.has(body.currentTrackId)
    ? body.currentTrackId
    : null;
  const position = Number(body.position);
  const volume = Number(body.volume);
  const baseQueueIds = cleanTrackIds(body.baseQueueIds);
  const queueIds = cleanTrackIds(body.queueIds);

  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(volume)) {
    return reply.code(400).send({ error: 'Estado do player inválido.' });
  }

  if (currentTrackId && !queueIds.includes(currentTrackId)) queueIds.unshift(currentTrackId);
  if (currentTrackId && !baseQueueIds.includes(currentTrackId)) baseQueueIds.unshift(currentTrackId);

  const state = database.savePlaybackState(request.user.id, {
    currentTrackId,
    position,
    volume: Math.max(0, Math.min(1, volume)),
    shuffle: Boolean(body.shuffle),
    repeatMode: cleanRepeatMode(body.repeatMode),
    wasPlaying: Boolean(body.wasPlaying),
    baseQueueIds,
    queueIds
  });

  reply.header('Cache-Control', 'private, no-store');
  return state;
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/lyrics', async (request, reply) => {
  const track = tracksById.get(request.params.id);
  if (!track || !libraryRoot) return reply.code(404).send({ error: 'Música não encontrada.' });

  const lyrics = await readTrackLyrics(libraryRoot, track.filePath);
  reply.header('Cache-Control', 'no-store');
  return reply.send(lyrics);
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/cover', async (request, reply) => {
  const track = tracksById.get(request.params.id);
  if (!track?.hasCover || !libraryRoot) return reply.code(404).send();

  return withCoverRequestSlot(async () => {
    try {
      const opened = await openRegularFileInside(libraryRoot, track.filePath);
      const cached = getCachedCover(track.id, opened.stat.size, opened.stat.mtimeMs);

      if (cached) {
        await opened.handle.close();
        reply.type(cached.format);
        reply.header('Cache-Control', 'private, max-age=86400');
        return cached.data;
      }

      const stream = opened.handle.createReadStream({ autoClose: true });
      const cover = await readCover(stream, track.mimeType);
      stream.destroy();
      if (!cover) return reply.code(404).send();

      const data = Buffer.from(cover.data);
      cacheCover(track.id, {
        data,
        format: cover.format,
        size: opened.stat.size,
        mtimeMs: opened.stat.mtimeMs
      });

      reply.type(cover.format);
      reply.header('Cache-Control', 'private, max-age=86400');
      return data;
    } catch (error) {
      if (isNotFoundLike(error)) return reply.code(404).send();
      throw error;
    }
  });
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/stream', async (request, reply) => {
  const track = tracksById.get(request.params.id);
  if (!track || !libraryRoot) return reply.code(404).send({ error: 'Música não encontrada.' });

  try {
    const opened = await openRegularFileInside(libraryRoot, track.filePath);
    const range = parseByteRange(request.headers.range, opened.stat.size);

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', track.mimeType);
    reply.header('Cache-Control', 'private, no-store');

    if (range === null) {
      await opened.handle.close();
      reply.header('Content-Range', `bytes */${opened.stat.size}`);
      return reply.code(416).send();
    }

    if (range === undefined) {
      reply.header('Content-Length', opened.stat.size);
      return reply.send(opened.handle.createReadStream({ autoClose: true }));
    }

    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${opened.stat.size}`);
    reply.header('Content-Length', range.end - range.start + 1);
    return reply.send(opened.handle.createReadStream({
      start: range.start,
      end: range.end,
      autoClose: true
    }));
  } catch (error) {
    if (isNotFoundLike(error)) return reply.code(404).send({ error: 'Música não encontrada.' });
    throw error;
  }
});

app.get<{ Params: { id: string }; Querystring: { quality?: string; normalization?: string } }>('/api/tracks/:id/transcode', async (request, reply) => {
  const track = tracksById.get(request.params.id);
  if (!track || !libraryRoot) return reply.code(404).send({ error: 'Música não encontrada.' });

  const quality = parseTranscodeQuality(request.query.quality);
  if (!quality) return reply.code(400).send({ error: 'Qualidade de transcoding inválida.' });
  const normalization = parseNormalizationMode(request.query.normalization);
  if (!normalization) return reply.code(400).send({ error: 'Modo de normalização inválido.' });
  const gainDb = replayGainForMode(track, normalization);
  if (!ffmpegStatus.available) {
    return reply.code(503).send({ error: 'Transcoding indisponível porque FFmpeg não está disponível.' });
  }

  try {
    const { prepared, transcoded } = await transcodeCacheMaintenance.withTranscode(async () => {
      const source = await openRegularFileInside(libraryRoot, track.filePath);
      let prepared;
      try {
        prepared = await transcodeManager.prepare({
          trackId: track.id,
          sourceSize: source.stat.size,
          sourceMtimeMs: source.stat.mtimeMs,
          quality,
          normalizationGainDb: gainDb,
          createInput: () => source.handle.createReadStream({ autoClose: false })
        });
      } finally {
        await source.handle.close().catch(() => undefined);
      }
      return {
        prepared,
        transcoded: await open(prepared.path, 'r')
      };
    });

    const info = await transcoded.stat();
    if (!info.isFile() || info.size <= 0) {
      await transcoded.close();
      return reply.code(503).send({ error: 'Áudio transcodificado não está disponível.' });
    }

    const range = parseByteRange(request.headers.range, info.size);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', 'audio/mp4');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Home-Music-Transcode-Quality', quality);
    reply.header('X-Home-Music-Transcode-Cache', prepared.cacheHit ? 'hit' : 'miss');
    reply.header('X-Home-Music-Normalization', normalization === 'off' ? 'off' : gainDb == null ? 'unavailable' : normalization);

    if (range === null) {
      await transcoded.close();
      reply.header('Content-Range', `bytes */${info.size}`);
      return reply.code(416).send();
    }

    if (range === undefined) {
      reply.header('Content-Length', info.size);
      return reply.send(transcoded.createReadStream({ autoClose: true }));
    }

    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
    reply.header('Content-Length', range.end - range.start + 1);
    return reply.send(transcoded.createReadStream({
      start: range.start,
      end: range.end,
      autoClose: true
    }));
  } catch (error) {
    if (isNotFoundLike(error)) return reply.code(404).send({ error: 'Música não encontrada.' });
    if (error instanceof TranscodeExecutionError) {
      app.log.warn(
        { err: error, trackId: track.id, quality, normalization, reason: error.reason },
        'Falha ao preparar áudio transcodificado.'
      );
      return reply.code(503).send({ error: 'Não foi possível preparar esta música na qualidade solicitada.' });
    }
    throw error;
  }
});

if (isProduction) {
  try {
    webApp = await prepareWebApp(webDistPath);
  } catch (error) {
    app.log.error({ err: error, webDistPath }, 'Frontend de produção não encontrado. Execute npm run build antes de npm start.');
    await app.close();
    throw error;
  }

  app.get('/*', async (request, reply) => {
    const pathname = requestPathname(request.url);
    if (!pathname) return reply.code(400).send({ error: 'URL inválida.' });
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Rota da API não encontrada.' });
    }
    return sendWebRequest(reply, webApp!, request.url);
  });
}

try {
  await initializeLibrary();
} catch (error) {
  libraryReady = false;
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
        const result = await rescan('automatic');
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
        app.log.warn({ err: error }, 'Rescan automático falhou; uma nova tentativa será feita no próximo intervalo.');
      }
    });
    app.log.info(
      { intervalSeconds: autoRescanIntervalSeconds, initialDelaySeconds: 15 },
      'Rescan automático da biblioteca habilitado.'
    );
  }
}
