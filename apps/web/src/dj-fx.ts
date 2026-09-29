import type { DjDeckId } from './dj-controller-contract';

export type DjFxKind = 'echo' | 'reverb';

export type DjDeckFxState = {
  echo: {
    enabled: boolean;
    wet: number;
    feedback: number;
    delaySeconds: number;
  };
  reverb: {
    enabled: boolean;
    wet: number;
  };
};

export type DjFxState = Record<DjDeckId, DjDeckFxState>;

export function clampDjFxUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampDjDelaySeconds(value: number) {
  if (!Number.isFinite(value)) return 0.25;
  return Math.max(0.06, Math.min(1.5, value));
}

export function createNeutralDjFxDeckState(): DjDeckFxState {
  return {
    echo: {
      enabled: false,
      wet: 0.25,
      feedback: 0.28,
      delaySeconds: 0.25
    },
    reverb: {
      enabled: false,
      wet: 0.22
    }
  };
}

export function createNeutralDjFxState(): DjFxState {
  return {
    a: createNeutralDjFxDeckState(),
    b: createNeutralDjFxDeckState()
  };
}
