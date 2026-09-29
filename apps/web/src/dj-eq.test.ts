import { describe, expect, it } from 'vitest';
import {
  DJ_EQ_GAIN_DB,
  clampDjEqValue,
  createNeutralDjEqState,
  djEqFilterParameters,
  djEqGainDb
} from './dj-eq';

describe('DJ EQ', () => {
  it('mantém estado neutro previsível por deck', () => {
    expect(createNeutralDjEqState()).toEqual({
      a: { low: 0, mid: 0, high: 0, filter: 0 },
      b: { low: 0, mid: 0, high: 0, filter: 0 }
    });
  });

  it('limita ganho e preserva neutralidade no centro', () => {
    expect(clampDjEqValue(Number.NaN)).toBe(0);
    expect(clampDjEqValue(-2)).toBe(-1);
    expect(clampDjEqValue(2)).toBe(1);
    expect(djEqGainDb(0)).toBe(0);
    expect(djEqGainDb(-1)).toBe(-DJ_EQ_GAIN_DB);
    expect(djEqGainDb(1)).toBe(DJ_EQ_GAIN_DB);
  });

  it('mapeia FILTER para low-pass, bypass e high-pass', () => {
    const lowPass = djEqFilterParameters(-1);
    const neutral = djEqFilterParameters(0);
    const highPass = djEqFilterParameters(1);

    expect(lowPass.type).toBe('lowpass');
    expect(lowPass.frequency).toBeCloseTo(200, 6);
    expect(neutral.type).toBe('allpass');
    expect(highPass.type).toBe('highpass');
    expect(highPass.frequency).toBeCloseTo(5_000, 6);
  });

  it('mantém cutoff monotônico conforme o knob se afasta do centro', () => {
    expect(djEqFilterParameters(-0.8).frequency)
      .toBeLessThan(djEqFilterParameters(-0.2).frequency);
    expect(djEqFilterParameters(0.8).frequency)
      .toBeGreaterThan(djEqFilterParameters(0.2).frequency);
  });
});
