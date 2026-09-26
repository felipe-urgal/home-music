import { performance } from 'node:perf_hooks';
import { analyzePcmWaveform, WAVEFORM_POINT_COUNT, WAVEFORM_SAMPLE_RATE } from './waveform-analysis.js';

export function benchmarkWaveformReducer(durationMinutes = 120) {
  const seconds = Math.max(1, Math.round(durationMinutes * 60));
  const samples = new Int16Array(seconds * WAVEFORM_SAMPLE_RATE);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(
      Math.sin((index / WAVEFORM_SAMPLE_RATE) * Math.PI * 2 * 2) * 24_000
    );
  }

  const startedAt = performance.now();
  const waveform = analyzePcmWaveform(samples);
  const durationMs = performance.now() - startedAt;

  return {
    inputDurationMinutes: durationMinutes,
    inputSamples: samples.length,
    inputBytes: samples.byteLength,
    outputPoints: waveform?.peaks.length ?? 0,
    expectedOutputPoints: WAVEFORM_POINT_COUNT,
    durationMs: Number(durationMs.toFixed(2))
  };
}

if (process.argv[1]?.endsWith('waveform-analysis.benchmark.ts')) {
  process.stdout.write(`${JSON.stringify(benchmarkWaveformReducer(), null, 2)}\n`);
}
