import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { resetLibraryIntegrityStatusForTests } from './library-integrity.js';
import { toPublicTrack } from './library-public-track.js';
import { scanLibrary } from './library.js';

const DEFAULT_TRACK_COUNT = 2_000;
const TRACK_COUNT = positiveInteger(process.env.HOME_MUSIC_BENCHMARK_TRACKS, DEFAULT_TRACK_COUNT);
const SCALE = Math.max(1, TRACK_COUNT / DEFAULT_TRACK_COUNT);
const MEBIBYTE = 1024 * 1024;

const LIMITS = {
  initialScanMs: 30_000 * SCALE,
  incrementalScanMs: 5_000 * SCALE,
  changedIncrementalScanMs: 6_000 * SCALE,
  publicPayloadMs: 2_000 * SCALE,
  heapUsedMb: 512 * SCALE,
  rssMb: 1_024 * SCALE
};

type Measurement<T> = {
  value: T;
  durationMs: number;
  heapDeltaMb: number;
  heapUsedMb: number;
  rssMb: number;
};

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function mb(bytes: number) {
  return Number((bytes / MEBIBYTE).toFixed(2));
}

function roundMs(value: number) {
  return Number(value.toFixed(2));
}

function collectGarbage() {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  gc?.();
}

async function measure<T>(operation: () => Promise<T> | T): Promise<Measurement<T>> {
  collectGarbage();
  const before = process.memoryUsage();
  const startedAt = performance.now();
  const value = await operation();
  const durationMs = performance.now() - startedAt;
  const after = process.memoryUsage();

  return {
    value,
    durationMs: roundMs(durationMs),
    heapDeltaMb: mb(after.heapUsed - before.heapUsed),
    heapUsedMb: mb(after.heapUsed),
    rssMb: mb(after.rss)
  };
}

function assertWithin(label: string, actual: number, limit: number, unit: string) {
  assert.ok(
    actual <= limit,
    `${label} excedeu o limite de regressão grave: ${actual}${unit} > ${roundMs(limit)}${unit}`
  );
}

function minimalWaveFile() {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  buffer.writeInt16LE(0, 44);
  return buffer;
}

function relativeSyntheticPath(index: number) {
  const genre = String(index % 8).padStart(2, '0');
  const artist = String(index % 80).padStart(2, '0');
  const album = String(index % 20).padStart(2, '0');
  const track = String(index + 1).padStart(5, '0');
  return path.join(`Genre-${genre}`, `Artist-${artist}`, `Album-${album}`, `Track-${track}.wav`);
}

async function createSyntheticLibrary(root: string) {
  const wave = minimalWaveFile();
  const paths = Array.from({ length: TRACK_COUNT }, (_, index) => path.join(root, relativeSyntheticPath(index)));
  const directories = [...new Set(paths.map(filePath => path.dirname(filePath)))];
  await Promise.all(directories.map(directory => mkdir(directory, { recursive: true })));

  const batchSize = 100;
  for (let offset = 0; offset < paths.length; offset += batchSize) {
    await Promise.all(paths.slice(offset, offset + batchSize).map(filePath => writeFile(filePath, wave)));
  }
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-large-library-'));
  resetLibraryIntegrityStatusForTests();

  try {
    const dataset = await measure(() => createSyntheticLibrary(root));
    const initial = await measure(() => scanLibrary(root));
    assert.equal(initial.value.tracks.length, TRACK_COUNT);
    assert.deepEqual(initial.value.stats, {
      added: TRACK_COUNT,
      updated: 0,
      removed: 0,
      unchanged: 0
    });

    const incremental = await measure(() => scanLibrary(root, initial.value.tracks));
    assert.deepEqual(incremental.value.stats, {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: TRACK_COUNT
    });

    const changedTrack = incremental.value.tracks[Math.floor(TRACK_COUNT / 2)];
    assert.ok(changedTrack, 'dataset sintético deve conter ao menos uma faixa');
    const changedMtime = new Date(changedTrack.mtimeMs + 60_000);
    await utimes(changedTrack.filePath, changedMtime, changedMtime);

    const changedIncremental = await measure(() => scanLibrary(root, incremental.value.tracks));
    assert.deepEqual(changedIncremental.value.stats, {
      added: 0,
      updated: 1,
      removed: 0,
      unchanged: TRACK_COUNT - 1
    });

    const publicPayload = await measure(() => JSON.stringify({
      tracks: changedIncremental.value.tracks.map(toPublicTrack),
      scannedAt: '2026-01-01T00:00:00.000Z',
      scanning: false,
      revision: 1
    }));
    const payloadMb = mb(Buffer.byteLength(publicPayload.value));

    assertWithin('scan inicial', initial.durationMs, LIMITS.initialScanMs, 'ms');
    assertWithin('scan incremental sem mudanças', incremental.durationMs, LIMITS.incrementalScanMs, 'ms');
    assertWithin('scan incremental com uma mudança', changedIncremental.durationMs, LIMITS.changedIncrementalScanMs, 'ms');
    assertWithin('materialização do payload público', publicPayload.durationMs, LIMITS.publicPayloadMs, 'ms');

    const memorySamples = [dataset, initial, incremental, changedIncremental, publicPayload];
    const maxHeapUsedMb = Math.max(...memorySamples.map(sample => sample.heapUsedMb));
    const maxRssMb = Math.max(...memorySamples.map(sample => sample.rssMb));
    assertWithin('heap usado', maxHeapUsedMb, LIMITS.heapUsedMb, 'MB');
    assertWithin('RSS', maxRssMb, LIMITS.rssMb, 'MB');

    console.log(JSON.stringify({
      benchmark: 'large-library-server',
      dataset: {
        tracks: TRACK_COUNT,
        audio: 'WAV PCM sintético de 1 amostra',
        creationMs: dataset.durationMs
      },
      measurements: {
        initialScan: {
          durationMs: initial.durationMs,
          heapDeltaMb: initial.heapDeltaMb
        },
        incrementalScanNoChanges: {
          durationMs: incremental.durationMs,
          heapDeltaMb: incremental.heapDeltaMb
        },
        incrementalScanOneChanged: {
          durationMs: changedIncremental.durationMs,
          heapDeltaMb: changedIncremental.heapDeltaMb
        },
        publicLibraryPayload: {
          durationMs: publicPayload.durationMs,
          payloadMb,
          heapDeltaMb: publicPayload.heapDeltaMb
        },
        memory: {
          maxHeapUsedMb,
          maxRssMb
        }
      },
      regressionLimits: {
        initialScanMs: roundMs(LIMITS.initialScanMs),
        incrementalScanMs: roundMs(LIMITS.incrementalScanMs),
        changedIncrementalScanMs: roundMs(LIMITS.changedIncrementalScanMs),
        publicPayloadMs: roundMs(LIMITS.publicPayloadMs),
        heapUsedMb: roundMs(LIMITS.heapUsedMb),
        rssMb: roundMs(LIMITS.rssMb)
      }
    }, null, 2));
  } finally {
    resetLibraryIntegrityStatusForTests();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
