import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzePcmRhythm,
  RHYTHM_ANALYSIS_SAMPLE_RATE
} from './rhythm-analysis.js';

function pulseTrack(
  bpm: number,
  firstBeatSeconds: number,
  durationSeconds = 24,
  sampleRate = RHYTHM_ANALYSIS_SAMPLE_RATE
) {
  const samples = new Int16Array(Math.round(durationSeconds * sampleRate));
  const period = 60 / bpm;
  const pulseSamples = Math.max(1, Math.round(sampleRate * 0.03));

  for (let beat = firstBeatSeconds; beat < durationSeconds; beat += period) {
    const start = Math.round(beat * sampleRate);
    for (let offset = 0; offset < pulseSamples && start + offset < samples.length; offset += 1) {
      const amplitude = Math.round(28_000 * Math.exp(-offset / (sampleRate * 0.006)));
      if (amplitude > samples[start + offset]) samples[start + offset] = amplitude;
    }
  }

  return samples;
}

for (const bpm of [60, 90, 120, 128, 150]) {
  test(`detecta BPM estável próximo de ${bpm}`, () => {
    const result = analyzePcmRhythm(pulseTrack(bpm, 0.3));
    assert.ok(result);
    assert.ok(Math.abs(result.bpm - bpm) <= 1, `BPM detectado: ${result.bpm}`);
    assert.ok(
      Math.abs(result.firstBeatSeconds - 0.3) <= 0.04,
      `Primeira batida detectada: ${result.firstBeatSeconds}`
    );
    assert.ok(result.confidence >= 0.5);
  });
}

test('respeita offset diferente de zero na primeira batida', () => {
  const result = analyzePcmRhythm(pulseTrack(128, 1.17));
  assert.ok(result);
  assert.ok(Math.abs(result.firstBeatSeconds - 1.17) <= 0.04);
});

test('silêncio não produz análise rítmica falsa', () => {
  const samples = new Int16Array(RHYTHM_ANALYSIS_SAMPLE_RATE * 12);
  assert.equal(analyzePcmRhythm(samples), null);
});

test('áudio muito curto não é analisado', () => {
  const samples = pulseTrack(120, 0.2, 2);
  assert.equal(analyzePcmRhythm(samples), null);
});
