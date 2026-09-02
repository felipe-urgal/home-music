import assert from 'node:assert/strict';
import { brotliDecompressSync } from 'node:zlib';
import test from 'node:test';
import Fastify from 'fastify';
import { registerLibraryRoutes } from './library-routes.js';
import type { LibraryService } from './library-service.js';

function createLibrary(trackCount = 2) {
  let revision = 3;
  let scannedAt = '2026-09-02T20:00:00.000Z';
  let tracks = Array.from({ length: trackCount }, (_, index) => ({
    id: `track-${index}`,
    title: `Faixa ${index}`,
    artist: 'Home Music',
    album: 'Biblioteca',
    duration: 180,
    folder: 'Musicas',
    folderPath: 'Musicas'
  }));

  const library = {
    listPublicTracks: () => tracks,
    status: () => ({
      scannedAt,
      scanning: false,
      revision,
      autoRescan: { enabled: true, intervalSeconds: 300 }
    }),
    rescan: async () => ({
      tracks: tracks.length,
      scannedAt,
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: tracks.length
    }),
    overview: () => ({}),
    checkIntegrity: async () => null
  } as unknown as LibraryService;

  return {
    library,
    changeSnapshot() {
      revision += 1;
      scannedAt = '2026-09-02T20:05:00.000Z';
      tracks = [...tracks, {
        id: 'track-new',
        title: 'Faixa nova',
        artist: 'Home Music',
        album: 'Biblioteca',
        duration: 210,
        folder: 'Novas',
        folderPath: 'Novas'
      }];
    }
  };
}

test('GET /api/library usa cache privado revalidavel e responde 304 para ETag atual', async () => {
  const state = createLibrary();
  const app = Fastify();
  registerLibraryRoutes(app, state.library);

  try {
    const first = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: { 'accept-encoding': 'identity' }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers['cache-control'], 'private, no-cache');
    assert.equal(first.headers.vary, 'Accept-Encoding');
    assert.match(String(first.headers.etag), /^W\/"library-r3-/);
    assert.equal(first.headers['content-encoding'], undefined);

    const unchanged = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: {
        'accept-encoding': 'br, gzip',
        'if-none-match': String(first.headers.etag)
      }
    });
    assert.equal(unchanged.statusCode, 304);
    assert.equal(unchanged.body, '');
    assert.equal(unchanged.headers.etag, first.headers.etag);
  } finally {
    await app.close();
  }
});

test('GET /api/library nunca retorna false 304 depois de mudar a revision', async () => {
  const state = createLibrary();
  const app = Fastify();
  registerLibraryRoutes(app, state.library);

  try {
    const first = await app.inject({ method: 'GET', url: '/api/library' });
    state.changeSnapshot();
    const changed = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: { 'if-none-match': String(first.headers.etag) }
    });

    assert.equal(changed.statusCode, 200);
    assert.notEqual(changed.headers.etag, first.headers.etag);
    assert.match(changed.body, /Faixa nova/);
  } finally {
    await app.close();
  }
});

test('GET /api/library comprime payload grande com brotli e status continua no-store', async () => {
  const state = createLibrary(250);
  const app = Fastify();
  registerLibraryRoutes(app, state.library);

  try {
    const compressed = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: { 'accept-encoding': 'br' }
    });
    assert.equal(compressed.statusCode, 200);
    assert.equal(compressed.headers['content-encoding'], 'br');
    const decoded = brotliDecompressSync(compressed.rawPayload).toString('utf8');
    assert.match(decoded, /track-249/);

    const status = await app.inject({ method: 'GET', url: '/api/library/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.headers['cache-control'], 'private, no-store');
  } finally {
    await app.close();
  }
});
