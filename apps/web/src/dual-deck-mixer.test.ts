import { describe, expect, it } from 'vitest';
import {
  automixTransitionGains,
  automixTransitionToCrossfader,
  clampCrossfader,
  createDefaultDualDeckMixerState,
  crossfaderGains,
  resolveDualDeckOutputGain
} from './dual-deck-mixer';

describe('dual deck mixer', () => {
  it('silencia o canal oposto nos extremos', () => {
    expect(crossfaderGains(-1)).toEqual({ a: 1, b: 0 });
    const right = crossfaderGains(1);
    expect(right.a).toBeCloseTo(0, 10);
    expect(right.b).toBe(1);
  });

  it('usa curva equal-power no centro', () => {
    const gains = crossfaderGains(0);
    expect(gains.a).toBeCloseTo(Math.SQRT1_2, 10);
    expect(gains.b).toBeCloseTo(Math.SQRT1_2, 10);
    expect((gains.a ** 2) + (gains.b ** 2)).toBeCloseTo(1, 10);
  });

  it('mantém a transição do AutoMix independente do crossfader manual', () => {
    expect(automixTransitionGains('a', 0)).toEqual({ a: 1, b: 0 });

    const center = automixTransitionGains('a', 0.5);
    expect(center.a).toBeCloseTo(Math.SQRT1_2, 10);
    expect(center.b).toBeCloseTo(Math.SQRT1_2, 10);
    expect((center.a ** 2) + (center.b ** 2)).toBeCloseTo(1, 10);

    const end = automixTransitionGains('a', 1);
    expect(end.a).toBeCloseTo(0, 10);
    expect(end.b).toBe(1);

    expect(resolveDualDeckOutputGain({
      deck: 'b',
      masterVolume: 1,
      channelVolume: 1,
      crossfader: -1,
      automixTransition: { fromDeck: 'a', progress: 1 }
    })).toBe(1);
  });

  it('converte o progresso do AutoMix para takeover manual sem salto', () => {
    expect(automixTransitionToCrossfader('a', 0)).toBe(-1);
    expect(automixTransitionToCrossfader('a', 0.5)).toBe(0);
    expect(automixTransitionToCrossfader('a', 1)).toBe(1);
    expect(automixTransitionToCrossfader('b', 0)).toBe(1);
    expect(automixTransitionToCrossfader('b', 1)).toBe(-1);
  });

  it('compõe master, channel e crossfader sem ultrapassar 1', () => {
    expect(resolveDualDeckOutputGain({
      deck: 'a',
      masterVolume: 0.8,
      channelVolume: 0.5,
      crossfader: -1
    })).toBeCloseTo(0.4, 10);

    expect(resolveDualDeckOutputGain({
      deck: 'b',
      masterVolume: 4,
      channelVolume: 4,
      crossfader: 1
    })).toBe(1);
  });

  it('faz clamp de entradas inválidas', () => {
    expect(clampCrossfader(-3)).toBe(-1);
    expect(clampCrossfader(3)).toBe(1);
    expect(clampCrossfader(Number.NaN)).toBe(0);
  });

  it('cria estado neutro previsível', () => {
    expect(createDefaultDualDeckMixerState()).toEqual({
      channelVolumes: { a: 1, b: 1 },
      crossfader: 0,
      eq: {
        a: { low: 0, mid: 0, high: 0, filter: 0 },
        b: { low: 0, mid: 0, high: 0, filter: 0 }
      },
      fx: {
        a: {
          echo: { enabled: false, wet: 0.25, feedback: 0.28, delaySeconds: 0.25 },
          reverb: { enabled: false, wet: 0.22 }
        },
        b: {
          echo: { enabled: false, wet: 0.25, feedback: 0.28, delaySeconds: 0.25 },
          reverb: { enabled: false, wet: 0.22 }
        }
      }
    });
  });
});
