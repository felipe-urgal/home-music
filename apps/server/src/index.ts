import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import Fastify from 'fastify';
import { readCover, scanLibrary, type IndexedTrack } from './library.js';
import {
  parseByteRange,
  resolveLibraryRoot,
  resolveRegularFileInside,
  UnsafeLibraryPathError
} from './security.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
config({ path: rootEnvPath });

const app = Fastify({
  logger: true,
  bodyLimit: 16 * 1024
});

const musicDir = process.env.MUSIC_DIR || '';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

let tracks: IndexedTrack[] = [];
let libraryRoot = '';
let scannedAt = new Date(0).toISOString();

const MAX_COVER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_COVER_CACHE_ITEMS = 64;
let coverCacheBytes = 0;

type CachedCover = {
  data: Buffer;
  format: string;
  size: number;
  mtimeMs: number;
};

const coverCache = new Map<string, CachedCover>();

function publicTrack(track: IndexedTrack) {
  const { filePath: _filePath, mimeType: _mimeType, ...safe } = track;
  return safe;
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

  // Atualiza a ordem para LRU.
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

async function rescan() {
  coverCache.clear();
  coverCacheBytes = 0;

  if (!musicDir) {
    tracks = [];
    libraryRoot = '';
    scannedAt = new Date().toISOString();
    return;
  }

  const resolvedRoot = await resolveLibraryRoot(musicDir);
  const nextTracks = await scanLibrary(resolvedRoot);

  libraryRoot = resolvedRoot;
  tracks = nextTracks;
  scannedAt = new Date().toISOString();
}

function isNotFoundLike(error: unknown) {
  if (error instanceof UnsafeLibraryPathError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  return payload;
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
    musicDirConfigured: Boolean(musicDir)
  };
});

app.get('/api/library', async (_request, reply) => {
  reply.header('Cache-Control', 'private, no-store');
  return {
    tracks: tracks.map(publicTrack),
    scannedAt
  };
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/cover', async (request, reply) => {
  const track = tracks.find(item => item.id === request.params.id);
  if (!track?.hasCover || !libraryRoot) return reply.code(404).send();

  try {
    const safeFile = await resolveRegularFileInside(libraryRoot, track.filePath);
    const cached = getCachedCover(track.id, safeFile.stat.size, safeFile.stat.mtimeMs);

    if (cached) {
      reply.type(cached.format);
      reply.header('Cache-Control', 'private, max-age=86400');
      return cached.data;
    }

    const cover = await readCover(safeFile.path);
    if (!cover) return reply.code(404).send();

    const data = Buffer.from(cover.data);
    cacheCover(track.id, {
      data,
      format: cover.format,
      size: safeFile.stat.size,
      mtimeMs: safeFile.stat.mtimeMs
    });

    reply.type(cover.format);
    reply.header('Cache-Control', 'private, max-age=86400');
    return data;
  } catch (error) {
    if (isNotFoundLike(error)) return reply.code(404).send();
    throw error;
  }
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/stream', async (request, reply) => {
  const track = tracks.find(item => item.id === request.params.id);
  if (!track || !libraryRoot) return reply.code(404).send({ error: 'Música não encontrada.' });

  try {
    const safeFile = await resolveRegularFileInside(libraryRoot, track.filePath);
    const range = parseByteRange(request.headers.range, safeFile.stat.size);

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', track.mimeType);
    reply.header('Cache-Control', 'private, no-store');

    if (range === null) {
      reply.header('Content-Range', `bytes */${safeFile.stat.size}`);
      return reply.code(416).send();
    }

    if (range === undefined) {
      reply.header('Content-Length', safeFile.stat.size);
      return reply.send(createReadStream(safeFile.path));
    }

    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${safeFile.stat.size}`);
    reply.header('Content-Length', range.end - range.start + 1);
    return reply.send(createReadStream(safeFile.path, { start: range.start, end: range.end }));
  } catch (error) {
    if (isNotFoundLike(error)) return reply.code(404).send({ error: 'Música não encontrada.' });
    throw error;
  }
});

try {
  await rescan();
} catch (error) {
  app.log.warn({ err: error }, 'Biblioteca ainda não pôde ser carregada. Verifique MUSIC_DIR.');
}

await app.listen({ port, host });
