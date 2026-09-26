import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrackRhythm } from '@home-music/shared';
import {
  deriveVariableBeatGrid,
  normalizeWindowBpm
} from './variable-beat-grid-analysis.js';

const base: TrackRhythm = {
  bpm: 120,
  firstBeatSeconds: 0.25,
  confidence: 0.95
};

test('faixa estável permanece no modelo simples', () => {
  const grid = deriveVariableBeatGrid(base, [
    { startSeconds: 0, bpm: 120, firstBeatSeconds: 0.25, confidence: 0.9 },
    { startSeconds: 18, bpm: 120.1, firstBeatSeconds: 18.25, confidence: 0.9 },
    { startSeconds: 36, bpm: 119.9, firstBeatSeconds: 36.25, confidence: 0.9 },
    { startSeconds: 54, bpm: 120.2, firstBeatSeconds: 54.25, confidence: 0.9 }
  ]);
  assert.equal(grid, null);
});

test('promove drift gradual para segmentos compactos', () => {
  const grid = deriveVariableBeatGrid(base, [
    { startSeconds: 0, bpm: 118, firstBeatSeconds: 0.25, confidence: 0.9 },
    { startSeconds: 18, bpm: 119, firstBeatSeconds: 18.21, confidence: 0.9 },
    { startSeconds: 36, bpm: 120, firstBeatSeconds: 36.17, confidence: 0.9 },
    { startSeconds: 54, bpm: 121, firstBeatSeconds: 54.12, confidence: 0.9 },
    { startSeconds: 72, bpm: 122, firstBeatSeconds: 72.08, confidence: 0.9 }
  ]);

  assert.ok(grid);
  assert.equal(grid.version, 1);
  assert.ok(grid.segments.length >= 2);
  assert.equal(grid.segments[0]?.bpm, 118);
  assert.equal(grid.segments.at(-1)?.bpm, 122);
});

test('normaliza half/double time antes de avaliar drift', () => {
  assert.equal(normalizeWindowBpm(60, 120), 120);
  assert.equal(normalizeWindowBpm(240, 120), 120);
  assert.equal(normalizeWindowBpm(121, 120), 121);
});

test('rejeita saltos locais incompatíveis com drift natural', () => {
  const grid = deriveVariableBeatGrid(base, [
    { startSeconds: 0, bpm: 118, firstBeatSeconds: 0.25, confidence: 0.9 },
    { startSeconds: 18, bpm: 119, firstBeatSeconds: 18.2, confidence: 0.9 },
    { startSeconds: 36, bpm: 145, firstBeatSeconds: 36.2, confidence: 0.9 },
    { startSeconds: 54, bpm: 121, firstBeatSeconds: 54.2, confidence: 0.9 }
  ]);
  assert.equal(grid, null);
});

test('ignora janelas de baixa confiança', () => {
  const grid = deriveVariableBeatGrid(base, [
    { startSeconds: 0, bpm: 118, firstBeatSeconds: 0.25, confidence: 0.9 },
    { startSeconds: 18, bpm: 119, firstBeatSeconds: 18.2, confidence: 0.2 },
    { startSeconds: 36, bpm: 120, firstBeatSeconds: 36.2, confidence: 0.2 },
    { startSeconds: 54, bpm: 122, firstBeatSeconds: 54.2, confidence: 0.9 }
  ]);
  assert.equal(grid, null);
});
