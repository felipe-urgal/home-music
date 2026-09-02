import { performance } from 'node:perf_hooks';
import type { LibraryService } from './library-service.js';
import { LibraryHttpSnapshotCache } from './library-http-cache.js';

const TRACK_COUNT = 10_000;
const SERIALIZE_ITERATIONS = 60;
const CACHE_ITERATIONS = 20_000;
const PARSE_ITERATIONS = 60;

const sourceTracks = Array.from({ length: TRACK_COUNT }, (_, index) => ({
  id: `track-${index.toString().padStart(5, '0')}`,
  title: `Faixa ${index} com um titulo representativo para a biblioteca`,
  artist: `Artista ${index % 400}`,
  album: `Album ${index % 900}`,
  duration: 120 + (index % 360),
  folder: `Colecao ${index % 50}`,
  folderPath: `Colecao ${index % 50}/Disco ${index % 250}`
}));

const status = {
  scannedAt: '2026-09-02T20:00:00.000Z',
  scanning: false,
  revision: 42,
  autoRescan: { enabled: true, intervalSeconds: 300 }
};

let projectionCalls = 0;
const source = {
  listPublicTracks() {
    projectionCalls += 1;
    return sourceTracks.map(track => ({ ...track })) as ReturnType<LibraryService['listPublicTracks']>;
  },
  status() {
    return status;
  }
} as Pick<LibraryService, 'listPublicTracks' | 'status'>;

function meanMs(iterations: number, callback: () => void) {
  global.gc?.();
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) callback();
  return (performance.now() - startedAt) / iterations;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function percentage(saved: number, total: number) {
  return `${((saved / total) * 100).toFixed(1)}%`;
}

const baselineSerializeMs = meanMs(SERIALIZE_ITERATIONS, () => {
  JSON.stringify({
    tracks: source.listPublicTracks(),
    ...status
  });
});

projectionCalls = 0;
const cache = new LibraryHttpSnapshotCache(source);
const snapshot = cache.snapshot();
const cachedSnapshotMs = meanMs(CACHE_ITERATIONS, () => {
  cache.snapshot();
});
const [brotliBody, gzipBody] = await Promise.all([
  cache.bodyFor(snapshot, 'br'),
  cache.bodyFor(snapshot, 'gzip')
]);
const parseMs = meanMs(PARSE_ITERATIONS, () => {
  JSON.parse(snapshot.body.toString('utf8'));
});

console.log('Home Music — benchmark do snapshot HTTP da biblioteca');
console.log(`tracks=${TRACK_COUNT}`);
console.log(`baseline_projection_and_serialize_avg_ms=${baselineSerializeMs.toFixed(3)}`);
console.log(`cached_snapshot_lookup_avg_ms=${cachedSnapshotMs.toFixed(6)}`);
console.log(`warm_projection_calls=${projectionCalls}`);
console.log(`client_json_parse_avg_ms=${parseMs.toFixed(3)}`);
console.log(`raw_bytes=${snapshot.body.byteLength} (${formatBytes(snapshot.body.byteLength)})`);
console.log(`gzip_bytes=${gzipBody.byteLength} (${formatBytes(gzipBody.byteLength)}; saved=${percentage(snapshot.body.byteLength - gzipBody.byteLength, snapshot.body.byteLength)})`);
console.log(`brotli_bytes=${brotliBody.byteLength} (${formatBytes(brotliBody.byteLength)}; saved=${percentage(snapshot.body.byteLength - brotliBody.byteLength, snapshot.body.byteLength)})`);
console.log('conditional_304_body_bytes=0');
