import { describe, expect, it } from 'vitest';
import { resolveHotCuePosition } from './dj-hot-cue-quantize';

describe('Hot Cue quantize', () => {
  it('mantém posição exata quando QUANTIZE está desligado', () => {
    expect(resolveHotCuePosition({
      positionSeconds: 1.43,
      durationSeconds: 180,
      rhythm: { bpm: 120, firstBeatSeconds: 0.25, confidence: 0.95 },
      quantize: false
    })).toBeCloseTo(1.43, 6);
  });

  it('encaixa na batida mais próxima com grid confiável', () => {
    expect(resolveHotCuePosition({
      positionSeconds: 1.43,
      durationSeconds: 180,
      rhythm: { bpm: 120, firstBeatSeconds: 0.25, confidence: 0.95 },
      quantize: true
    })).toBeCloseTo(1.25, 6);
  });

  it('usa o segmento ativo do beat grid variável', () => {
    expect(resolveHotCuePosition({
      positionSeconds: 20.68,
      durationSeconds: 180,
      rhythm: {
        bpm: 120,
        firstBeatSeconds: 0,
        confidence: 0.95,
        beatGrid: {
          version: 1,
          segments: [
            { startSeconds: 0, bpm: 120, firstBeatSeconds: 0, confidence: 0.95 },
            { startSeconds: 20, bpm: 60, firstBeatSeconds: 20.25, confidence: 0.95 }
          ]
        }
      },
      quantize: true
    })).toBeCloseTo(20.25, 6);
  });

  it('faz fallback para posição exata quando a confiança é baixa', () => {
    expect(resolveHotCuePosition({
      positionSeconds: 1.43,
      durationSeconds: 180,
      rhythm: { bpm: 120, firstBeatSeconds: 0.25, confidence: 0.2 },
      quantize: true
    })).toBeCloseTo(1.43, 6);
  });

  it('limita o resultado à duração conhecida da faixa', () => {
    expect(resolveHotCuePosition({
      positionSeconds: 180.4,
      durationSeconds: 180,
      rhythm: { bpm: 120, firstBeatSeconds: 0, confidence: 0.95 },
      quantize: true
    })).toBe(180);
  });
});
