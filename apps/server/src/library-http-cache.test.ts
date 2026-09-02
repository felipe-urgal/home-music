import assert from 'node:assert/strict';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import {
  LIBRARY_COMPRESSION_MIN_BYTES,
  LibraryHttpSnapshotCache,
  matchesIfNoneMatch,
  selectLibraryContentEncoding
} from './library-http-cache.js';
import type { LibraryService } from './library-service.js';

function createSource(trackCount = 2) {
  let revision = 7;
  let scannedAt = '2026-09-02T20:00:00.000Z';
  let scanning = false;
  let projectionCalls = 0;
  let tracks = Array.from({ length: trackCount }, (_, index) => ({
    id: `track-${index}`,
    title: `Faixa ${index}`,
    artist: 'Home Music',
    album: 'Biblioteca',
    duration: 180,
    folder: 'Musicas',
    folderPath: 'Musicas'
  })) as ReturnType<LibraryService['listPublicTracks']>;

  const source = {
    listPublicTracks() {
      projectionCalls += 1;
      return tracks;
    },
    status() {
      return {
        scannedAt,
        scanning,
        revision,
        autoRescan: { enabled: true, intervalSeconds: 300 }
      };
    }
  } as Pick<LibraryService, 'listPublicTracks' | 'status'>;

  return {
    source,
    projectionCalls: () => projectionCalls,
    setRevision(value: number) { revision = value; },
    setScannedAt(value: string) { scannedAt = value; },
    setScanning(value: boolean) { scanning = value; },
    setTracks(value: ReturnType<LibraryService['listPublicTracks']>) { tracks = value; }
  };
}

test('snapshot HTTP reutiliza projecao enquanto a revision nao muda', () => {
  const state = createSource();
  const cache = new LibraryHttpSnapshotCache(state.source);

  const first = cache.snapshot();
  const second = cache.snapshot();
  assert.equal(second, first);
  assert.equal(state.projectionCalls(), 1);

  state.setScanning(true);
  const scanning = cache.snapshot();
  assert.notEqual(scanning.etag, first.etag);
  assert.equal(state.projectionCalls(), 1);

  state.setScanning(false);
  state.setScannedAt('2026-09-02T20:05:00.000Z');
  const rescanned = cache.snapshot();
  assert.notEqual(rescanned.etag, first.etag);
  assert.equal(state.projectionCalls(), 1);
});

test('mudanca de revision reprojeta faixas e nunca reaproveita ETag anterior', () => {
  const state = createSource();
  const cache = new LibraryHttpSnapshotCache(state.source);
  const first = cache.snapshot();

  state.setTracks([{
    id: 'track-new',
    title: 'Faixa nova',
    artist: 'Home Music',
    album: 'Biblioteca',
    duration: 200,
    folder: 'Novas',
    folderPath: 'Novas'
  }] as ReturnType<LibraryService['listPublicTracks']>);
  state.setRevision(8);
  const changed = cache.snapshot();

  assert.equal(state.projectionCalls(), 2);
  assert.notEqual(changed.etag, first.etag);
  assert.match(changed.etag, /^W\/"library-r8-/);
  assert.match(changed.body.toString('utf8'), /Faixa nova/);
});

test('ETag inclui hash do corpo para evitar false 304 mesmo com a mesma revision', () => {
  const firstState = createSource(1);
  const secondState = createSource(3);
  const first = new LibraryHttpSnapshotCache(firstState.source).snapshot();
  const second = new LibraryHttpSnapshotCache(secondState.source).snapshot();

  assert.equal(first.revision, second.revision);
  assert.notEqual(first.etag, second.etag);
  assert.equal(matchesIfNoneMatch(first.etag, first.etag), true);
  assert.equal(matchesIfNoneMatch(`"outro", ${first.etag}`, first.etag), true);
  assert.equal(matchesIfNoneMatch('*', first.etag), true);
  assert.equal(matchesIfNoneMatch(second.etag, first.etag), false);
});

test('negociacao prioriza brotli, respeita gzip e nao comprime payload pequeno', () => {
  assert.equal(
    selectLibraryContentEncoding('gzip, br', LIBRARY_COMPRESSION_MIN_BYTES),
    'br'
  );
  assert.equal(
    selectLibraryContentEncoding('br;q=0, gzip;q=1', LIBRARY_COMPRESSION_MIN_BYTES),
    'gzip'
  );
  assert.equal(
    selectLibraryContentEncoding('identity', LIBRARY_COMPRESSION_MIN_BYTES),
    'identity'
  );
  assert.equal(
    selectLibraryContentEncoding('gzip, br', LIBRARY_COMPRESSION_MIN_BYTES - 1),
    'identity'
  );
});

test('brotli e gzip preservam exatamente o JSON serializado e sao cacheados', async () => {
  const state = createSource(200);
  const cache = new LibraryHttpSnapshotCache(state.source);
  const snapshot = cache.snapshot();
  assert.ok(snapshot.body.byteLength >= LIBRARY_COMPRESSION_MIN_BYTES);

  const brotli = cache.bodyFor(snapshot, 'br');
  const gzip = cache.bodyFor(snapshot, 'gzip');
  assert.equal(cache.bodyFor(snapshot, 'br'), brotli);
  assert.equal(cache.bodyFor(snapshot, 'gzip'), gzip);

  const [brotliBody, gzipBody] = await Promise.all([brotli, gzip]);
  assert.deepEqual(brotliDecompressSync(brotliBody), snapshot.body);
  assert.deepEqual(gunzipSync(gzipBody), snapshot.body);
  assert.ok(brotliBody.byteLength < snapshot.body.byteLength);
  assert.ok(gzipBody.byteLength < snapshot.body.byteLength);
});
