import { describe, expect, it } from 'vitest';
import {
  clampTvSeek,
  stepTvVolume,
  TV_CROSSFADE_PRESETS,
  TV_SEEK_STEP_SECONDS,
  tvCrossfadeOptions
} from './tv-controls';

describe('tv controls', () => {
  it('avança e retrocede o player em passos previsíveis sem sair da faixa', () => {
    expect(clampTvSeek(42, 180, TV_SEEK_STEP_SECONDS)).toBe(52);
    expect(clampTvSeek(4, 180, -TV_SEEK_STEP_SECONDS)).toBe(0);
    expect(clampTvSeek(178, 180, TV_SEEK_STEP_SECONDS)).toBe(180);
  });

  it('ajusta volume em passos limitados ao intervalo do player', () => {
    expect(stepTvVolume(0.5, 0.1)).toBe(0.6);
    expect(stepTvVolume(0.05, -0.1)).toBe(0);
    expect(stepTvVolume(0.95, 0.1)).toBe(1);
  });

  it('oferece presets simples de crossfade sem perder um valor já salvo', () => {
    expect(TV_CROSSFADE_PRESETS).toEqual([0, 3, 5, 8, 12]);
    expect(tvCrossfadeOptions(7)).toEqual([0, 3, 5, 7, 8, 12]);
    expect(tvCrossfadeOptions(5)).toEqual([0, 3, 5, 8, 12]);
  });
});
