import { performance } from 'node:perf_hooks';
import type { TrackRhythm } from '@home-music/shared';
import { deriveVariableBeatGrid } from './variable-beat-grid-analysis.js';

export function benchmarkVariableBeatGrid(windowCount = 20) {
  const rhythm: TrackRhythm = {
    bpm: 120,
    firstBeatSeconds: 0.25,
    confidence: 0.95
  };
  const windows = Array.from({ length: windowCount }, (_, index) => ({
    startSeconds: index * 18,
    bpm: 118 + ((4 * index) / Math.max(1, windowCount - 1)),
    firstBeatSeconds: (index * 18) + 0.25,
    confidence: 0.9
  }));

  const startedAt = performance.now();
  let grid = null;
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    grid = deriveVariableBeatGrid(rhythm, windows);
  }
  const durationMs = performance.now() - startedAt;
  const jsonBytes = Buffer.byteLength(JSON.stringify(grid ?? {}), 'utf8');

  return {
    windowCount,
    segmentCount: grid?.segments.length ?? 0,
    jsonBytes,
    iterations: 10_000,
    durationMs: Number(durationMs.toFixed(2))
  };
}

if (process.argv[1]?.endsWith('variable-beat-grid-analysis.benchmark.ts')) {
  process.stdout.write(`${JSON.stringify(benchmarkVariableBeatGrid(), null, 2)}\n`);
}
