import { describe, expect, it } from 'vitest';
import { validWaveform } from './track-waveform-client';

describe('track waveform client validation', () => {
  it('aceita waveform derivado válido', () => {
    expect(validWaveform({
      version: 1,
      durationSeconds: 180,
      peaks: [0, 0.25, 0.5, 1]
    })).toBe(true);
  });

  it('rejeita peaks fora de 0..1 e payload vazio', () => {
    expect(validWaveform({
      version: 1,
      durationSeconds: 180,
      peaks: [0, 1.2]
    })).toBe(false);
    expect(validWaveform({
      version: 1,
      durationSeconds: 180,
      peaks: []
    })).toBe(false);
  });

  it('rejeita versão e duração inválidas', () => {
    expect(validWaveform({
      version: 0,
      durationSeconds: 180,
      peaks: [1]
    })).toBe(false);
    expect(validWaveform({
      version: 1,
      durationSeconds: Number.NaN,
      peaks: [1]
    })).toBe(false);
  });
});
