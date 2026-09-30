import { describe, expect, it } from 'vitest';
import { moveDjLoop, resizeDjLoop, resolveDjLoopPoint } from './dj-loop-operations';

const rhythm = {
  bpm: 120,
  firstBeatSeconds: 0.25,
  confidence: 0.95
};

describe('DJ advanced loop operations', () => {
  it('quantiza IN/OUT quando o grid é confiável', () => {
    expect(resolveDjLoopPoint({
      positionSeconds: 1.43,
      durationSeconds: 180,
      rhythm,
      quantize: true
    })).toEqual({ seconds: 1.25, quantized: true });
  });

  it('degrada para posição manual quando confidence é baixa', () => {
    expect(resolveDjLoopPoint({
      positionSeconds: 1.43,
      durationSeconds: 180,
      rhythm: { ...rhythm, confidence: 0.1 },
      quantize: true
    })).toEqual({ seconds: 1.43, quantized: false });
  });

  it('redimensiona para meio beat', () => {
    const resized = resizeDjLoop({
      loopIn: 2,
      loopOut: 4,
      rhythm,
      durationSeconds: 180,
      beats: 0.5
    });
    expect(resized?.endSeconds).toBeCloseTo(2.25, 6);
    expect(resized?.beats).toBe(0.5);
  });

  it('usa BPM do segmento ativo ao redimensionar', () => {
    const variable = {
      ...rhythm,
      beatGrid: {
        version: 1 as const,
        segments: [
          { startSeconds: 0, bpm: 120, firstBeatSeconds: 0.25, confidence: 0.95 },
          { startSeconds: 20, bpm: 60, firstBeatSeconds: 20.25, confidence: 0.95 }
        ]
      }
    };
    const resized = resizeDjLoop({
      loopIn: 20.25,
      loopOut: 22.25,
      rhythm: variable,
      durationSeconds: 180,
      beats: 2
    });
    expect(resized?.endSeconds).toBeCloseTo(22.25, 6);
  });

  it('move o loop por beats e preserva sua duração', () => {
    const moved = moveDjLoop({
      loopIn: 2,
      loopOut: 4,
      rhythm,
      durationSeconds: 180,
      direction: 1,
      beats: 2
    });
    expect(moved?.startSeconds).toBeCloseTo(3, 6);
    expect(moved?.endSeconds).toBeCloseTo(5, 6);
  });

  it('limita movimento aos limites da faixa', () => {
    expect(moveDjLoop({
      loopIn: 0.5,
      loopOut: 2.5,
      rhythm,
      durationSeconds: 10,
      direction: -1,
      beats: 4
    })).toMatchObject({ startSeconds: 0, endSeconds: 2 });

    expect(moveDjLoop({
      loopIn: 8,
      loopOut: 10,
      rhythm,
      durationSeconds: 10,
      direction: 1,
      beats: 2
    })).toMatchObject({ startSeconds: 8, endSeconds: 10 });
  });
});
