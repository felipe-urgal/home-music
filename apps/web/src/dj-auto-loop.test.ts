import { describe, expect, it } from 'vitest';
import { djLoopWaveformRange, resolveDjAutoLoopPlan } from './dj-auto-loop';

const rhythm = {
  bpm: 120,
  firstBeatSeconds: 0.25,
  confidence: 0.95
};

describe('DJ Auto Loop', () => {
  it('quantiza o início na batida mais próxima e cria 4 beats', () => {
    expect(resolveDjAutoLoopPlan({
      positionSeconds: 1.43,
      durationSeconds: 180,
      rhythm,
      beats: 4
    })).toEqual({
      startSeconds: 1.25,
      endSeconds: 3.25,
      beats: 4,
      quantized: true
    });
  });

  it('usa BPM do segmento ativo em beat grid variável', () => {
    const plan = resolveDjAutoLoopPlan({
      positionSeconds: 20.6,
      durationSeconds: 180,
      beats: 2,
      rhythm: {
        ...rhythm,
        beatGrid: {
          version: 1,
          segments: [
            { startSeconds: 0, bpm: 120, firstBeatSeconds: 0.25, confidence: 0.95 },
            { startSeconds: 20, bpm: 60, firstBeatSeconds: 20.25, confidence: 0.95 }
          ]
        }
      }
    });
    expect(plan?.startSeconds).toBeCloseTo(20.25, 6);
    expect(plan?.endSeconds).toBeCloseTo(22.25, 6);
    expect(plan?.quantized).toBe(true);
  });

  it('faz fallback para posição atual quando o grid não é confiável', () => {
    const plan = resolveDjAutoLoopPlan({
      positionSeconds: 10,
      durationSeconds: 180,
      rhythm: { ...rhythm, confidence: 0.1 },
      beats: 4
    });
    expect(plan?.startSeconds).toBe(10);
    expect(plan?.endSeconds).toBe(12);
    expect(plan?.quantized).toBe(false);
  });

  it('limita o final à duração da faixa', () => {
    const plan = resolveDjAutoLoopPlan({
      positionSeconds: 9.8,
      durationSeconds: 10,
      rhythm,
      beats: 4
    });
    expect(plan?.endSeconds).toBe(10);
    expect(plan?.endSeconds).toBeGreaterThan(plan!.startSeconds);
  });

  it('rejeita tamanho inválido e ausência de BPM utilizável', () => {
    expect(resolveDjAutoLoopPlan({
      positionSeconds: 1,
      durationSeconds: 10,
      rhythm: undefined,
      beats: 3
    })).toBeNull();
    expect(resolveDjAutoLoopPlan({
      positionSeconds: 1,
      durationSeconds: 10,
      rhythm: undefined,
      beats: 4
    })).toBeNull();
  });

  it('calcula a faixa visual do loop', () => {
    expect(djLoopWaveformRange({ loopIn: 30, loopOut: 60, durationSeconds: 120 }))
      .toEqual({ start: 0.25, end: 0.5 });
    expect(djLoopWaveformRange({ loopIn: null, loopOut: 60, durationSeconds: 120 }))
      .toBeNull();
  });
});
