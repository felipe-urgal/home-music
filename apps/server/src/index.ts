import { timingSafeEqual } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { PlaybackState, RepeatMode, ScanResponse } from '@home-music/shared';
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
const authConfigured = Boolean(authUser && authPassword.length >= 12);

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

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(header: string | undefined) {
  if (!header?.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    return safeEqual(decoded.slice(0, separator), authUser) &&
      safeEqual(decoded.slice(separator + 1), authPassword);
  } catch {
    return false;
  }
}

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
  const result = await scanLibrary(resolvedRoot, previous);
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

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return;

  if (!authConfigured) {
    return reply.code(503).send({ error: 'Autenticação do Home Music não configurada.' });
  }

  if (!isAuthorized(request.headers.authorization)) {
    reply.header('WWW-Authenticate', 'Basic realm="Home Music", charset="UTF-8"');
    return reply.code(401).send({ error: 'Autenticação necessária.' });
  }
});

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
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

app.get<{ Querystring: { limit?: string } }>('/api/history', async request => ({
  items: database.getHistory(Number(request.query.limit || 200))
}));

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
  const queueIds = cleanTrackIds(body.queueIds);

  if (!Number.isFinite(position) || position < 0 || !Number.isFinite(volume)) {
    return reply.code(400).send({ error: 'Estado do player inválido.' });
  }

  const state = database.savePlaybackState({
    currentTrackId,
    position,
    volume: Math.max(0, Math.min(1, volume)),
    shuffle: Boolean(body.shuffle),
    repeatMode: cleanRepeatMode(body.repeatMode),
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
