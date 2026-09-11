import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import {
  crossfadeDurationSeconds,
  readCrossfadeMode,
  resolveCrossfadeCandidate,
  writeCrossfadeMode
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

  it('mapeia os presets para janelas curtas e previsíveis', () => {
    expect(crossfadeDurationSeconds('off')).toBe(0);
    expect(crossfadeDurationSeconds('soft')).toBe(3);
    expect(crossfadeDurationSeconds('continuous')).toBe(5);
  });

  it('é desativado por padrão e persiste somente valores suportados', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };

    expect(readCrossfadeMode(storage)).toBe('off');
    writeCrossfadeMode(storage, 'continuous');
    expect(readCrossfadeMode(storage)).toBe('continuous');
    values.set('home-music:crossfade-mode:v1', 'inválido');
    expect(readCrossfadeMode(storage)).toBe('off');
  });

  it('libera a próxima faixa somente dentro da janela configurada e em foreground', () => {
    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      mode: 'continuous',
      visibilityState: 'visible',
      remainingSeconds: 4.8
    })).toEqual({ trackId: 'b', durationSeconds: 5 });

    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      mode: 'continuous',
      visibilityState: 'visible',
      remainingSeconds: 6
    })).toBeNull();

    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'off',
      mode: 'continuous',
      visibilityState: 'hidden',
      remainingSeconds: 4
    })).toBeNull();
  });

  it('não cria segundo stream em repeat one', () => {
    expect(resolveCrossfadeCandidate({
      queue,
      currentIndex: 0,
      currentTrackId: 'a',
      repeatMode: 'one',
      mode: 'soft',
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
      mode: 'soft',
      visibilityState: 'visible',
      remainingSeconds: 1
    })).toEqual({ trackId: 'a', durationSeconds: 3 });
  });
});
