import { describe, expect, it } from 'vitest';
import type { PlaybackState, Track } from '@home-music/shared';
import {
  nextTrackDecision,
  remapQueue,
  resolveOutputVolume,
  restorePlayerState,
  uniqueTracksById
} from './player-state';

function track(id: string, title = id): Track {
  return {
    id,
    title,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Pasta',
    folderPath: 'Pasta',
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
}

function state(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    currentTrackId: 'b',
    position: 42,
    volume: 0.7,
    shuffle: false,
    repeatMode: 'off',
    wasPlaying: false,
    baseQueueIds: ['a', 'b', 'c'],
    queueIds: ['a', 'b', 'c'],
    updatedAt: '2026-08-24T12:00:00.000Z',
    ...overrides
  };
}

describe('restorePlayerState', () => {
  const tracks = [track('a'), track('b'), track('c')];

  it('restaura fila base, fila efetiva e posição da mesma faixa', () => {
    const restored = restorePlayerState(tracks, state({
      shuffle: true,
      baseQueueIds: ['a', 'b', 'c'],
      queueIds: ['b', 'c', 'a']
    }));

    expect(restored.baseQueue.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(restored.queue.map(item => item.id)).toEqual(['b', 'c', 'a']);
    expect(restored.currentTrackId).toBe('b');
    expect(restored.position).toBe(42);
  });

  it('zera a posição quando a faixa salva não existe mais', () => {
    const restored = restorePlayerState(tracks, state({ currentTrackId: 'removida', position: 99 }));
    expect(restored.currentTrackId).toBe('a');
    expect(restored.position).toBe(0);
  });
});

describe('reconciliação de fila', () => {
  it('substitui objetos antigos pelos metadados atuais', () => {
    const oldTrack = track('a', 'Título antigo');
    const newTrack = track('a', 'Título novo');
    expect(remapQueue([oldTrack], new Map([['a', newTrack]]))[0].title).toBe('Título novo');
  });

  it('remove duplicatas preservando a primeira ocorrência', () => {
    expect(uniqueTracksById([track('a'), track('a'), track('b')]).map(item => item.id)).toEqual(['a', 'b']);
  });
});

describe('resolveOutputVolume', () => {
  it('usa volume máximo do elemento quando o dispositivo controla volume pelo sistema', () => {
    expect(resolveOutputVolume(0.25, true)).toBe(1);
  });

  it('preserva o volume salvo no desktop', () => {
    expect(resolveOutputVolume(0.25, false)).toBe(0.25);
  });

  it('limita valores inválidos', () => {
    expect(resolveOutputVolume(2, false)).toBe(1);
    expect(resolveOutputVolume(-1, false)).toBe(0);
    expect(resolveOutputVolume(Number.NaN, false)).toBe(1);
  });
});

describe('nextTrackDecision', () => {
  it('reinicia fila unitária em repeat all', () => {
    expect(nextTrackDecision([track('a')], 0, 'all', false)).toEqual({ type: 'restart' });
  });

  it('repete a faixa ao terminar em repeat one', () => {
    expect(nextTrackDecision([track('a'), track('b')], 0, 'one', true)).toEqual({ type: 'restart' });
  });

  it('para no fim com repeat desligado', () => {
    expect(nextTrackDecision([track('a')], 0, 'off', true)).toEqual({ type: 'stop' });
  });
});
