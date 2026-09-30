import { describe, expect, it } from 'vitest';
import { djKeyFromPitchClass, type Track } from '@home-music/shared';
import { selectDjAutomixNext } from './dj-automix-selection';

function track(
  id: string,
  options: {
    bpm?: number;
    rhythmConfidence?: number;
    pitchClass?: number;
    keyConfidence?: number;
    duration?: number;
  } = {}
): Track {
  return {
    id,
    title: id,
    artist: 'Artist',
    album: '',
    albumArtist: '',
    folder: '',
    folderPath: '',
    duration: options.duration ?? 180,
    format: 'mp3',
    hasCover: false,
    rhythm: options.bpm
      ? {
          bpm: options.bpm,
          firstBeatSeconds: 0,
          confidence: options.rhythmConfidence ?? 0.9
        }
      : null,
    key: options.pitchClass == null
      ? null
      : djKeyFromPitchClass(options.pitchClass, 'major', options.keyConfidence ?? 0.9)
  };
}

describe('DJ AutoMix intelligent selection', () => {
  it('prefere BPM próximo a uma faixa distante', () => {
    const current = track('current', { bpm: 128 });
    const close = track('close', { bpm: 130 });
    const far = track('far', { bpm: 95 });

    expect(selectDjAutomixNext({
      tracks: [current, far, close],
      currentTrack: current,
      currentIndex: 0
    })?.track.id).toBe('close');
  });

  it('usa compatibilidade harmônica quando key está disponível', () => {
    const current = track('current', { bpm: 128, pitchClass: 0 });
    const distant = track('distant', { bpm: 128, pitchClass: 1 });
    const same = track('same', { bpm: 128, pitchClass: 0 });

    const selected = selectDjAutomixNext({
      tracks: [current, distant, same],
      currentTrack: current,
      currentIndex: 0
    });

    expect(selected?.track.id).toBe('same');
    expect(selected?.reason).toContain('tonalidade');
  });

  it('degrada para ordem atual quando metadata musical está ausente', () => {
    const current = track('a', { duration: 0 });
    const b = track('b', { duration: 0 });
    const c = track('c', { duration: 0 });

    const selected = selectDjAutomixNext({
      tracks: [aWithoutMetadata(current), aWithoutMetadata(b), aWithoutMetadata(c)],
      currentTrack: aWithoutMetadata(current),
      currentIndex: 0
    });

    expect(selected?.track.id).toBe('b');
    expect(selected?.usedMusicalScoring).toBe(false);
    expect(selected?.reason).toBe('ordem da biblioteca');
  });

  it('evita faixa já tocada quando existe alternativa equivalente', () => {
    const current = track('current', { bpm: 128 });
    const played = track('played', { bpm: 128 });
    const fresh = track('fresh', { bpm: 128 });

    expect(selectDjAutomixNext({
      tracks: [current, played, fresh],
      currentTrack: current,
      currentIndex: 0,
      playedTrackIds: new Set(['played'])
    })?.track.id).toBe('fresh');
  });

  it('mantém desempate determinístico pela ordem circular', () => {
    const current = track('current', { bpm: 128 });
    const first = track('first', { bpm: 126 });
    const second = track('second', { bpm: 130 });

    expect(selectDjAutomixNext({
      tracks: [current, first, second],
      currentTrack: current,
      currentIndex: 0
    })?.track.id).toBe('first');
  });

  it('permite rejeitar a próxima sugestão sem reordenar a lista', () => {
    const current = track('current', { bpm: 128 });
    const best = track('best', { bpm: 128 });
    const next = track('next', { bpm: 129 });
    const tracks = [current, best, next];

    const selected = selectDjAutomixNext({
      tracks,
      currentTrack: current,
      currentIndex: 0,
      rejectedTrackIds: new Set(['best'])
    });

    expect(selected?.track.id).toBe('next');
    expect(tracks.map(item => item.id)).toEqual(['current', 'best', 'next']);
  });

  it('repete a única faixa disponível', () => {
    const only = track('only');
    expect(selectDjAutomixNext({
      tracks: [only],
      currentTrack: only,
      currentIndex: 0
    })?.track.id).toBe('only');
  });
});

function aWithoutMetadata(value: Track): Track {
  return {
    ...value,
    duration: null,
    rhythm: null,
    key: null
  };
}
