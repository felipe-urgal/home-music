import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { PlaybackState, RepeatMode, ScanResponse } from '@home-music/shared';
import {
  buildSessionCookie,
  LoginRateLimiter,
  readCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SessionManager
} from './auth.js';
import { HomeMusicDatabase } from './database.js';
import { readCover, scanLibrary, type IndexedTrack } from './library.js';
import {
  openRegularFileInside,
  parseByteRange,
  resolveLibraryRoot,
  UnsafeLibraryPathError
} from './security.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const databasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
config({ path: rootEnvPath });

const app = Fastify({
  logger: true,
  bodyLimit: 256 * 1024
});

const database = new HomeMusicDatabase(databasePath);
const musicDir = process.env.MUSIC_DIR || '';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const authUser = process.env.HOME_MUSIC_USER || '';
const authPassword = process.env.HOME_MUSIC_PASSWORD || '';
const sessions = new SessionManager(authUser, authPassword);
const loginRateLimiter = new LoginRateLimiter();
const authConfigured = sessions.configured;
const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const publicAuthRoutes = new Set(['/api/auth/status', '/api/auth/login']);

let tracks: IndexedTrack[] = [];
let tracksById = new Map<string, IndexedTrack>();
let libraryRoot = '';
let scannedAt = new Date(0).toISOString();
let scanPromise: Promise<ScanResponse> | null = null;

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
  tracksById = new Map(nextTracks.map(track => [track.id, track]));
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
  clearCoverCache();

  if (!musicDir) {
    setTracks([]);
    libraryRoot = '';
    scannedAt = new Date().toISOString();
    return { tracks: 0, scannedAt, added: 0, updated: 0, removed: 0, unchanged: 0 };
  }

  const resolvedRoot = await resolveLibraryRoot(musicDir);
  const previous = libraryRoot === resolvedRoot ? tracks : [];
  const result = await scanLibrary(resolvedRoot, previous, (message, error) => {
    app.log.warn({ err: error }, message);
  });
  const nextScannedAt = new Date().toISOString();

  database.syncTracks(result.tracks, resolvedRoot, nextScannedAt);
  libraryRoot = resolvedRoot;
  scannedAt = nextScannedAt;
  setTracks(result.tracks);

  return {
    tracks: tracks.length,
    scannedAt,
    ...result.stats
  };
}

function rescan() {
  if (scanPromise) return scanPromise;

  scanPromise = performRescan().finally(() => {
    scanPromise = null;
  });
  return scanPromise;
}

async function initializeLibrary() {
  if (!musicDir) {
    setTracks([]);
    return;
  }

  const resolvedRoot = await resolveLibraryRoot(musicDir);
  const storedRoot = database.getMetadata('libraryRoot');
  const storedScannedAt = database.getMetadata('scannedAt');

  if (storedRoot === resolvedRoot && storedScannedAt) {
    libraryRoot = resolvedRoot;
    scannedAt = storedScannedAt;
    setTracks(database.loadTracks());
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

function cleanRepeatMode(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off';
}

function requestPath(url: string) {
  return url.split('?', 1)[0];
}

function requestSessionToken(cookieHeader: string | undefined) {
  return readCookie(cookieHeader, SESSION_COOKIE_NAME);
}

function requestIsSecure(request: { protocol: string; headers: Record<string, unknown> }) {
  const forwarded = request.headers['x-forwarded-proto'];
  const forwardedProtocol = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return request.protocol === 'https' || forwardedProtocol === 'https';
}

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;

  const path = requestPath(request.url);
  const isPublicAuthRoute = publicAuthRoutes.has(path);

  if (!authConfigured && path !== '/api/auth/status') {
    return reply.code(503).send({ error: 'Autenticação do Home Music não configurada.' });
  }

  if (path === '/api/auth/login') {
    if (request.headers['x-home-music-request'] !== '1') {
      return reply.code(403).send({ error: 'Requisição de login não autorizada.' });
    }
    return;
  }

  if (!isPublicAuthRoute) {
    const token = requestSessionToken(request.headers.cookie);
    if (!sessions.validateSession(token)) {
      return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
    }
  }

  if (mutatingMethods.has(request.method) && request.headers['x-home-music-request'] !== '1') {
    return reply.code(403).send({ error: 'Requisição de alteração não autorizada.' });
  }
});

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return payload;
});

app.addHook('onClose', async () => {
  database.close();
});

app.setErrorHandler((error, request, reply) => {
  app.log.error({ err: error, method: request.method, url: request.url }, 'Erro não tratado na API');
  if (!reply.sent) reply.code(500).send({ error: 'Erro interno do servidor.' });
});

app.get('/health', async (_request, reply) => {
  reply.header('Cache-Control', 'no-store');
  return {
    ok: true,
    tracks: tracks.length,
    scannedAt,
    scanning: Boolean(scanPromise),
    musicDirConfigured: Boolean(musicDir),
    authConfigured
  };
});

app.get('/api/auth/status', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const token = requestSessionToken(request.headers.cookie);
  return {
    configured: authConfigured,
    authenticated: authConfigured && sessions.validateSession(token)
  };
});

app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/auth/login', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const key = request.ip;

  if (loginRateLimiter.isBlocked(key)) {
    reply.header('Retry-After', '300');
    return reply.code(429).send({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  }

  const username = typeof request.body?.username === 'string' ? request.body.username : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';

  if (!sessions.validateCredentials(username, password)) {
    loginRateLimiter.recordFailure(key);
    return reply.code(401).send({ error: 'Usuário ou senha inválidos.' });
  }

  loginRateLimiter.clear(key);
  const token = sessions.createSession();
  reply.header('Set-Cookie', buildSessionCookie(token, SESSION_TTL_SECONDS, requestIsSecure(request)));
  return { authenticated: true };
});

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
    tracks: tracks.map(publicTrack),
    scannedAt,
    scanning: Boolean(scanPromise)
  };
});

app.post('/api/library/scan', async (_request, reply) => {
  const result = await rescan();
  reply.header('Cache-Control', 'no-store');
  return result;
});

app.get('/api/favorites', async () => ({
  trackIds: database.getFavoriteIds()
}));

app.put<{ Params: { id: string }; Body: { favorite?: boolean } }>('/api/favorites/:id', async (request, reply) => {
  if (!tracksById.has(request.params.id)) return reply.code(404).send({ error: 'Música não encontrada.' });
  if (typeof request.body?.favorite !== 'boolean') return reply.code(400).send({ error: 'Valor de favorito inválido.' });

  database.setFavorite(request.params.id, request.body.favorite);
  return { favorite: request.body.favorite };
});

app.get<{ Querystring: { limit?: string } }>('/api/history', async request => {
  const requestedLimit = Number(request.query.limit || 200);
  return {
    items: database.getHistory(Number.isFinite(requestedLimit) ? requestedLimit : 200)
  };
});

app.post<{ Params: { id: string } }>('/api/history/:id', async (request, reply) => {
  if (!tracksById.has(request.params.id)) return reply.code(404).send({ error: 'Música não encontrada.' });
  database.recordHistory(request.params.id);
  return reply.code(204).send();
});

app.delete('/api/history', async (_request, reply) => {
  database.clearHistory();
  return reply.code(204).send();
});

app.get('/api/playlists', async () => ({
  playlists: database.getPlaylists()
}));

app.post<{ Body: { name?: string } }>('/api/playlists', async (request, reply) => {
  const name = cleanName(request.body?.name);
  if (!name) return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });

  const id = database.createPlaylist(name);
  const playlist = database.getPlaylists().find(item => item.id === id);
  return reply.code(201).send({ playlist });
});

app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/playlists/:id', async (request, reply) => {
  const name = cleanName(request.body?.name);
  if (!name) return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });
  if (!database.renamePlaylist(request.params.id, name)) return reply.code(404).send({ error: 'Playlist não encontrada.' });
  return { ok: true };
});

app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (request, reply) => {
  if (!database.deletePlaylist(request.params.id)) return reply.code(404).send({ error: 'Playlist não encontrada.' });
  return reply.code(204).send();
});

app.put<{ Params: { id: string }; Body: { trackIds?: unknown } }>('/api/playlists/:id/tracks', async (request, reply) => {
  if (!Array.isArray(request.body?.trackIds)) return reply.code(400).send({ error: 'Lista de músicas inválida.' });
  const trackIds = cleanTrackIds(request.body.trackIds);

  if (!database.setPlaylistTracks(request.params.id, trackIds)) {
    return reply.code(404).send({ error: 'Playlist não encontrada.' });
  }

  return { trackIds };
});

app.get('/api/player/state', async () => database.loadPlaybackState());

app.put<{ Body: Partial<PlaybackState> }>('/api/player/state', async (request, reply) => {
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

  const state = database.savePlaybackState({
    currentTrackId,
    position,
    volume: Math.max(0, Math.min(1, volume)),
    shuffle: Boolean(body.shuffle),
    repeatMode: cleanRepeatMode(body.repeatMode),
    wasPlaying: Boolean(body.wasPlaying),
    baseQueueIds,
    queueIds
  });

  return state;
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

try {
  await initializeLibrary();
} catch (error) {
  app.log.warn({ err: error }, 'Biblioteca ainda não pôde ser carregada. Verifique MUSIC_DIR.');
}

await app.listen({ port, host });