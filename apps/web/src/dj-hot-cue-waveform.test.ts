import { describe, expect, it } from 'vitest';
import { buildDjHotCueWaveformMarkers } from './dj-hot-cue-waveform';

describe('DJ Hot Cue waveform markers', () => {
  it('converte Hot Cues em posições relativas preservando índice e segundos', () => {
    expect(buildDjHotCueWaveformMarkers([0, 45, null, 90], 180)).toEqual([
      { index: 0, seconds: 0, position: 0 },
      { index: 1, seconds: 45, position: 0.25 },
      { index: 3, seconds: 90, position: 0.5 }
    ]);
  });

  it('ignora cues ausentes ou fora da duração', () => {
    expect(buildDjHotCueWaveformMarkers([null, 181, 12, null], 180)).toEqual([
      { index: 2, seconds: 12, position: 12 / 180 }
    ]);
  });

  it('não cria marcadores sem duração válida', () => {
    expect(buildDjHotCueWaveformMarkers([10, null, null, null], 0)).toEqual([]);
    expect(buildDjHotCueWaveformMarkers([10, null, null, null], Number.NaN)).toEqual([]);
  });
});
