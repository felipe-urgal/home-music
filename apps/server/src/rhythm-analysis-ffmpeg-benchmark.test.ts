import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkRounds, summarizeDurations, overlapMs } from './rhythm-analysis-ffmpeg.benchmark.js';

test('benchmark rejeita quantidade inválida ou excessiva de rodadas', () => {
  assert.equal(benchmarkRounds(undefined), 3);
  assert.equal(benchmarkRounds('1'), 1);
  for (const raw of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '11']) {
    assert.throws(() => benchmarkRounds(raw));
  }
});

test('resumo usa mediana e preserva extremos sem alterar amostras', () => {
  const values = [40, 10, 20, 30];
  assert.deepEqual(summarizeDurations(values), { minMs: 10, medianMs: 25, maxMs: 40 });
  assert.deepEqual(values, [40, 10, 20, 30]);
  assert.deepEqual(summarizeDurations([7]), { minMs: 7, medianMs: 7, maxMs: 7 });
  for (const invalid of [[], [NaN], [Infinity], [-1]]) {
    assert.throws(() => summarizeDurations(invalid));
  }
});

test('sobreposição não confunde execução sequencial com concorrência', () => {
  assert.equal(overlapMs({ start: 0, end: 20 }, { start: 10, end: 40 }), 10);
  assert.equal(overlapMs({ start: 0, end: 20 }, { start: 20, end: 40 }), 0);
  assert.equal(overlapMs({ start: 30, end: 40 }, { start: 0, end: 20 }), 0);
});
