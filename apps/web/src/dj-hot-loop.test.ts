import { describe, expect, it } from 'vitest';
import { resolveDjHotLoopPlan } from './dj-hot-loop';

const rhythm = {
  bpm: 120,
  firstBeatSeconds: 0.25,
  confidence: 0.95
};

describe('DJ Hot Loop', () => {
  it('mantém exatamente o Hot Cue como início', () => {
    const plan = resolveDjHotLoopPlan({
      cueSeconds: 1.43,
      durationSeconds: 180,
      rhythm,
      beats: 4
    });

    expect(plan?.startSeconds).toBeCloseTo(1.43, 6);
    expect(plan?.endSeconds).toBeCloseTo(3.43, 6);
    expect(plan?.beats).toBe(4);
  });

  it('usa BPM do segmento variável no ponto do Hot Cue', () => {
    const plan = resolveDjHotLoopPlan({
      cueSeconds: 20.6,
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
    expect(plan?.startSeconds).toBeCloseTo(20.6, 6);
    expect(plan?.endSeconds).toBeCloseTo(22.6, 6);
  });

  it('limita o fim à duração da faixa', () => {
    const plan = resolveDjHotLoopPlan({
      cueSeconds: 9.8,
      durationSeconds: 10,
      rhythm,
      beats: 4
    });
    expect(plan?.startSeconds).toBe(9.8);
    expect(plan?.endSeconds).toBe(10);
  });

  it('recusa operação sem BPM utilizável', () => {
    expect(resolveDjHotLoopPlan({
      cueSeconds: 1,
      durationSeconds: 10,
      rhythm: undefined,
      beats: 4
    })).toBeNull();
  });

  it('recusa cue/tamanho inválidos', () => {
    expect(resolveDjHotLoopPlan({
      cueSeconds: -1,
      durationSeconds: 10,
      rhythm,
      beats: 4
    })).toBeNull();
    expect(resolveDjHotLoopPlan({
      cueSeconds: 1,
      durationSeconds: 10,
      rhythm,
      beats: 3 as never
    })).toBeNull();
  });
});
