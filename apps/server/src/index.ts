import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { readCover, scanLibrary, type IndexedTrack } from './library.js';
import {
  openRegularFileInside,
  parseByteRange,
  resolveLibraryRoot,
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

function publicTrack(track: IndexedTrack) {
  const { filePath: _filePath, mimeType: _mimeType, ...safe } = track;
  return safe;
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
  const track = tracks.find(item => item.id === request.params.id);
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
  await rescan();
} catch (error) {
  app.log.warn({ err: error }, 'Biblioteca ainda não pôde ser carregada. Verifique MUSIC_DIR.');
}

await app.listen({ port, host });
