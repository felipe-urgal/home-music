import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePcmWaveform, WAVEFORM_ANALYZER_VERSION } from './waveform-analysis.js';

test('waveform real diferencia silêncio, pico e região constante', () => {
  const samples = new Int16Array(4_000);
  for (let index = 1_000; index < 2_000; index += 1) samples[index] = 4_000;
  samples[2_500] = 32_767;

  const waveform = analyzePcmWaveform(samples, 1_000, 8);
  assert.ok(waveform);
  assert.equal(waveform.version, WAVEFORM_ANALYZER_VERSION);
  assert.equal(waveform.durationSeconds, 4);
  assert.equal(waveform.peaks.length, 8);
  assert.equal(waveform.peaks[0], 0);
  assert.ok((waveform.peaks[2] ?? 0) > 0);
  assert.equal(Math.max(...waveform.peaks), 1);
});

test('waveform normaliza seno sem ultrapassar 0..1', () => {
  const samples = new Int16Array(2_000);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(Math.sin((index / 40) * Math.PI * 2) * 20_000);
  }
  const waveform = analyzePcmWaveform(samples, 1_000, 32);
  assert.ok(waveform);
  assert.equal(waveform.peaks.length, 32);
  assert.ok(waveform.peaks.every(value => value >= 0 && value <= 1));
  assert.ok(waveform.peaks.every(value => value > 0.9));
});

test('waveform vazio ou parâmetros inválidos degradam para null', () => {
  assert.equal(analyzePcmWaveform(new Int16Array(), 1_000, 32), null);
  assert.equal(analyzePcmWaveform(new Int16Array([1, 2]), 0, 32), null);
  assert.equal(analyzePcmWaveform(new Int16Array([1, 2]), 1_000, 0), null);
});
