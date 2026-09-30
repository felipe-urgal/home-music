import { describe, expect, it } from 'vitest';
import { buildDjHotCueWaveformMarkers } from './dj-hot-cue-waveform';

describe('DJ Hot Cue waveform markers', () => {
  it('converte Hot Cues em posições relativas preservando índice e segundos', () => {
    expect(buildDjHotCueWaveformMarkers([0, 45, null, 90], 180)).toEqual([
      { index: 0, seconds: 0, position: 0, color: null, label: null },
      { index: 1, seconds: 45, position: 0.25, color: null, label: null },
      { index: 3, seconds: 90, position: 0.5, color: null, label: null }
    ]);
  });

  it('propaga cor e label para o waveform', () => {
    expect(buildDjHotCueWaveformMarkers(
      [10, null, 30, null],
      120,
      ['purple', null, 'cyan', null],
      ['Intro', null, 'Drop', null]
    )).toEqual([
      { index: 0, seconds: 10, position: 10 / 120, color: 'purple', label: 'Intro' },
      { index: 2, seconds: 30, position: 30 / 120, color: 'cyan', label: 'Drop' }
    ]);
  });

  it('ignora cues ausentes ou fora da duração', () => {
    expect(buildDjHotCueWaveformMarkers([null, 181, 12, null], 180)).toEqual([
      { index: 2, seconds: 12, position: 12 / 180, color: null, label: null }
    ]);
  });

  it('não cria marcadores sem duração válida', () => {
    expect(buildDjHotCueWaveformMarkers([10, null, null, null], 0)).toEqual([]);
    expect(buildDjHotCueWaveformMarkers([10, null, null, null], Number.NaN)).toEqual([]);
  });
});
