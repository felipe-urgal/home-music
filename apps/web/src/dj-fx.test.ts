import { describe, expect, it } from 'vitest';
import {
  clampDjDelaySeconds,
  clampDjFxUnit,
  createNeutralDjFxState
} from './dj-fx';

describe('DJ FX', () => {
  it('cria estado neutro previsível por deck', () => {
    expect(createNeutralDjFxState()).toEqual({
      a: {
        echo: { enabled: false, wet: 0.25, feedback: 0.28, delaySeconds: 0.25 },
        reverb: { enabled: false, wet: 0.22 }
      },
      b: {
        echo: { enabled: false, wet: 0.25, feedback: 0.28, delaySeconds: 0.25 },
        reverb: { enabled: false, wet: 0.22 }
      }
    });
  });

  it('limita valores normalizados e delay', () => {
    expect(clampDjFxUnit(Number.NaN)).toBe(0);
    expect(clampDjFxUnit(-1)).toBe(0);
    expect(clampDjFxUnit(2)).toBe(1);
    expect(clampDjDelaySeconds(Number.NaN)).toBe(0.25);
    expect(clampDjDelaySeconds(0)).toBe(0.06);
    expect(clampDjDelaySeconds(3)).toBe(1.5);
  });

  it('não compartilha objetos internos entre decks', () => {
    const state = createNeutralDjFxState();
    state.a.echo.wet = 0.9;
    expect(state.b.echo.wet).toBe(0.25);
  });
});
