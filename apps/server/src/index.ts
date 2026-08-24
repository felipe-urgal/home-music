import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { scanLibrary, type IndexedTrack } from './library.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
config({ path: rootEnvPath });

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const musicDir = process.env.MUSIC_DIR || '';
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

let tracks: IndexedTrack[] = [];
let scannedAt = new Date(0).toISOString();

function publicTrack(track: IndexedTrack) {
  const { filePath: _filePath, mimeType: _mimeType, cover: _cover, ...safe } = track;
  return safe;
}

async function rescan() {
  if (!musicDir) {
    tracks = [];
    scannedAt = new Date().toISOString();
    return;
  }

  tracks = await scanLibrary(musicDir);
  scannedAt = new Date().toISOString();
}

app.get('/health', async () => ({
  ok: true,
  tracks: tracks.length,
  scannedAt,
  musicDirConfigured: Boolean(musicDir)
}));

app.get('/api/library', async () => ({
  tracks: tracks.map(publicTrack),
  scannedAt,
  musicDir
}));

app.post('/api/library/scan', async (_request, reply) => {
  try {
    await rescan();
    return { tracks: tracks.length, scannedAt };
  } catch (error) {
    app.log.error(error);
    return reply.code(500).send({ error: 'Não foi possível ler a pasta de músicas.' });
  }
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/cover', async (request, reply) => {
  const track = tracks.find(item => item.id === request.params.id);
  if (!track?.cover) return reply.code(404).send();

  reply.type(track.cover.format);
  reply.header('Cache-Control', 'public, max-age=86400');
  return Buffer.from(track.cover.data);
});

app.get<{ Params: { id: string } }>('/api/tracks/:id/stream', async (request, reply) => {
  const track = tracks.find(item => item.id === request.params.id);
  if (!track) return reply.code(404).send({ error: 'Música não encontrada.' });

  const fileStat = await stat(track.filePath);
  const range = request.headers.range;

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', track.mimeType);

  if (!range) {
    reply.header('Content-Length', fileStat.size);
    return reply.send(createReadStream(track.filePath));
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    reply.header('Content-Range', `bytes */${fileStat.size}`);
    return reply.code(416).send();
  }

  const start = match[1] ? Number(match[1]) : 0;
  const requestedEnd = match[2] ? Number(match[2]) : fileStat.size - 1;
  const end = Math.min(requestedEnd, fileStat.size - 1);

  if (start > end || start >= fileStat.size) {
    reply.header('Content-Range', `bytes */${fileStat.size}`);
    return reply.code(416).send();
  }

  reply.code(206);
  reply.header('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
  reply.header('Content-Length', end - start + 1);
  return reply.send(createReadStream(track.filePath, { start, end }));
});

try {
  await rescan();
} catch (error) {
  app.log.warn({ err: error }, 'Biblioteca ainda não pôde ser carregada. Verifique MUSIC_DIR.');
}

await app.listen({ port, host });
