import { describe, expect, it } from 'vitest';
import { waveformBars } from './waveform-bars';

describe('waveformBars', () => {
  it('reduz os picos ao número de barras mantendo o maior valor no teto', () => {
    const peaks = Array.from({ length: 1_000 }, (_value, index) => (index === 500 ? 1 : 0.1));
    const bars = waveformBars(peaks, 10);

    expect(bars).toHaveLength(10);
    expect(Math.max(...bars)).toBe(96);
    expect(bars[5]).toBe(96);
    expect(bars[0]).toBeLessThan(bars[5]);
  });

  it('usa altura mínima para faixa silenciosa e vazio para entrada vazia', () => {
    expect(waveformBars([0, 0, 0, 0], 2)).toEqual([8, 8]);
    expect(waveformBars([], 4)).toEqual([]);
  });

  it('não perde barras quando há menos picos que barras', () => {
    expect(waveformBars([0.5, 1], 6)).toHaveLength(6);
  });
});
