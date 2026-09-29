import { describe, expect, it } from 'vitest';
import {
  clampDjDelaySeconds,
  clampDjFxUnit,
  createNeutralDjFxState,
  resolveDjFxDryGain
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

  it('mantém dry em 100% no bypass e reduz pelo maior mix ativo', () => {
    const state = createNeutralDjFxState().a;
    expect(resolveDjFxDryGain(state)).toBe(1);

    state.echo.enabled = true;
    state.echo.wet = 0.4;
    expect(resolveDjFxDryGain(state)).toBeCloseTo(0.6);

    state.reverb.enabled = true;
    state.reverb.wet = 0.7;
    expect(resolveDjFxDryGain(state)).toBeCloseTo(0.3);
  });
});
