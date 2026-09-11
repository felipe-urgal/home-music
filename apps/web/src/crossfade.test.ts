import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import {
  MAX_CROSSFADE_SECONDS,
  normalizeCrossfadeSeconds,
  readCrossfadeSeconds,
  resolveCrossfadeCandidate,
  writeCrossfadeSeconds
} from './crossfade';

function track(id: string): Track {
  return {
    id,
    title: id,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Pasta',
    folderPath: '',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null
  };
}

describe('crossfade', () => {
  const queue = [track('a'), track('b'), track('c')];

  it('normaliza a duração configurável para um intervalo seguro', () => {
    expect(normalizeCrossfadeSeconds(-1)).toBe(0);
    expect(normalizeCrossfadeSeconds(4.6)).toBe(5);
    expect(normalizeCrossfadeSeconds(8)).toBe(8);
    expect(normalizeCrossfadeSeconds(99)).toBe(MAX_CROSSFADE_SECONDS);
    expect(normalizeCrossfadeSeconds('inválido')).toBe(0);
  });

  it('é desativado por padrão, persiste segundos e migra os presets antigos', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };

    expect(readCrossfadeSeconds(storage)).toBe(0);

    values.set('home-music:crossfade-mode:v1', 'soft');
    expect(readCrossfadeSeconds(storage)).toBe(3);

    values.set('home-music:crossfade-mode:v1', 'continuous');
    expect(readCrossfadeSeconds(storage)).toBe(5);

    writeCrossfadeSeconds(storage, 7);
    expect(readCrossfadeSeconds(storage)).toBe(7);
  });

  it('libera a próxima faixa somente dentro da janela configurada e em foreground', () => {
    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      durationSeconds: 5,
      visibilityState: 'visible',
      remainingSeconds: 4.8
    })).toEqual({ trackId: 'b', durationSeconds: 5 });

    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      durationSeconds: 5,
      visibilityState: 'visible',
      remainingSeconds: 6
    })).toBeNull();

    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      durationSeconds: 5,
      visibilityState: 'hidden',
      remainingSeconds: 4
    })).toBeNull();
  });

  it('desativa a transição com duração zero', () => {
    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      durationSeconds: 0,
      visibilityState: 'visible',
      remainingSeconds: 0
    })).toBeNull();
  });

  it('não cria segundo stream em repeat one', () => {
    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'one',
      durationSeconds: 5,
      visibilityState: 'visible',
      remainingSeconds: 2
    })).toBeNull();
  });

  it('respeita repeat all ao chegar no fim da fila', () => {
    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 2,
      currentTrackId: 'c',
      repeatMode: 'all',
      durationSeconds: 3,
      visibilityState: 'visible',
      remainingSeconds: 1
    })).toEqual({ trackId: 'a', durationSeconds: 3 });
  });
});
