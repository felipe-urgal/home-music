import type { DjDeckId } from './dj-controller-contract';

export type DjEqControl = 'low' | 'mid' | 'high' | 'filter';

export type DjChannelEqState = Record<DjEqControl, number>;

export type DjEqFilterParameters = {
  type: BiquadFilterType;
  frequency: number;
  q: number;
};

export const DJ_EQ_GAIN_DB = 18;

export function clampDjEqValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function createNeutralDjEqState(): Record<DjDeckId, DjChannelEqState> {
  return {
    a: { low: 0, mid: 0, high: 0, filter: 0 },
    b: { low: 0, mid: 0, high: 0, filter: 0 }
  };
}

export function djEqGainDb(value: number) {
  return clampDjEqValue(value) * DJ_EQ_GAIN_DB;
}

function exponentialRange(start: number, end: number, progress: number) {
  if (start <= 0 || end <= 0) return start;
  return start * ((end / start) ** Math.max(0, Math.min(1, progress)));
}

export function djEqFilterParameters(value: number): DjEqFilterParameters {
  const normalized = clampDjEqValue(value);

  if (Math.abs(normalized) < 0.005) {
    return {
      type: 'allpass',
      frequency: 1_000,
      q: 0.0001
    };
  }

  if (normalized < 0) {
    return {
      type: 'lowpass',
      frequency: exponentialRange(20_000, 200, Math.abs(normalized)),
      q: 0.7
    };
  }

  return {
    type: 'highpass',
    frequency: exponentialRange(20, 5_000, normalized),
    q: 0.7
  };
}
