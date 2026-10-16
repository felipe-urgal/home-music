import assert from 'node:assert/strict';
import { open, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerMediaRoutes } from './media-routes.js';
import type { LibraryService } from './library-service.js';
import type { TrackMediaInfrastructure } from './track-media-infrastructure.js';

const BYTES = Buffer.from('0123456789abcdefghij');

test('HTTP stream: full, bounded range, suffix, unsatisfiable, missing and unavailable file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-stream-http-'));
  const filePath = path.join(root, 'song.mp3');
  await writeFile(filePath, BYTES);
  const track = { id: 'song', mimeType: 'audio/mpeg' };
  let missing = false;
  const app = Fastify();
  const library = { root, getTrack: (id: string) => id === 'song' ? track : undefined };
  const media = {
    openTrack: async (id: string) => {
      if (id !== 'song' || missing) return null;
      const handle = await open(filePath, 'r');
      return { track, opened: { handle, stat: await handle.stat() } };
    }
  };
  registerMediaRoutes(app, library as unknown as LibraryService, media as unknown as TrackMediaInfrastructure);
  try {
    const full = await app.inject({ method: 'GET', url: '/api/tracks/song/stream' });
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers['content-type'], 'audio/mpeg');
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(Number(full.headers['content-length']), BYTES.length);
    assert.deepEqual(full.rawPayload, BYTES);

    const range = await app.inject({ method: 'GET', url: '/api/tracks/song/stream', headers: { range: 'bytes=3-7' } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers['content-range'], `bytes 3-7/${BYTES.length}`);
    assert.equal(Number(range.headers['content-length']), 5);
    assert.deepEqual(range.rawPayload, BYTES.subarray(3, 8));

    const invalid = await app.inject({ method: 'GET', url: '/api/tracks/song/stream', headers: { range: 'bytes=999-1000' } });
    assert.equal(invalid.statusCode, 416);
    assert.equal(invalid.headers['content-range'], `bytes */${BYTES.length}`);
    assert.equal((await app.inject({ method: 'GET', url: '/api/tracks/nope/stream' })).statusCode, 404);

    missing = true;
    assert.equal((await app.inject({ method: 'GET', url: '/api/tracks/song/stream' })).statusCode, 404);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('HTTP transcode: miss, hit, range, 416, invalid profile and FFmpeg unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-transcode-http-'));
  const filePath = path.join(root, 'cached.m4a');
  await writeFile(filePath, BYTES);
  const track = { id: 'song', mimeType: 'audio/mpeg' };
  const library = { root, getTrack: (id: string) => id === 'song' ? track : undefined };
  const app = Fastify();
  let reads = 0;
  let releases = 0;
  let available = true;
  const media = {
    get ffmpegAvailable() { return available; },
    prepareTranscode: async () => {
      reads++;
      return {
        track, prepared: { path: filePath, cacheHit: reads > 1 },
        transcoded: await open(filePath, 'r'),
        gainDb: null,
        release: () => { releases++; }
      };
    }
  };
  registerMediaRoutes(app, library as unknown as LibraryService, media as unknown as TrackMediaInfrastructure);
  try {
    const full = await app.inject({ method: 'GET', url: '/api/tracks/song/transcode' });
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers['x-home-music-transcode-cache'], 'miss');
    assert.equal(full.headers['content-type'], 'audio/mp4');
    assert.deepEqual(full.rawPayload, BYTES);

    const range = await app.inject({ method: 'GET', url: '/api/tracks/song/transcode', headers: { range: 'bytes=5-9' } });
    assert.equal(range.statusCode, 206);
    assert.equal(range.headers['x-home-music-transcode-cache'], 'hit');
    assert.equal(range.headers['content-range'], `bytes 5-9/${BYTES.length}`);
    assert.deepEqual(range.rawPayload, BYTES.subarray(5, 10));

    const invalid = await app.inject({ method: 'GET', url: '/api/tracks/song/transcode', headers: { range: 'bytes=900-' } });
    assert.equal(invalid.statusCode, 416);
    assert.equal(invalid.headers['content-range'], `bytes */${BYTES.length}`);
    assert.equal(releases, 3);

    assert.equal((await app.inject({ method: 'GET', url: '/api/tracks/song/transcode?quality=unknown' })).statusCode, 400);
    available = false;
    assert.equal((await app.inject({ method: 'GET', url: '/api/tracks/song/transcode' })).statusCode, 503);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
