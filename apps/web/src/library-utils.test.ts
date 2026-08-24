import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { buildQueueContext, groupTracks, matchesTrack, normalizeSearch } from './library-utils';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: '1',
    title: 'Festa',
    artist: 'Ivete Sangalo',
    album: 'Festa',
    albumArtist: 'Ivete Sangalo',
    folder: 'Axé',
    duration: 180,
    format: 'MP3',
    hasCover: true,
    ...overrides
  };
}

describe('normalizeSearch', () => {
  it('ignora acentos e caixa', () => {
    expect(normalizeSearch('  AxÉ  ')).toBe('axe');
  });
});

describe('matchesTrack', () => {
  it('encontra por pasta sem exigir acento', () => {
    expect(matchesTrack(track(), normalizeSearch('axe'))).toBe(true);
  });

  it('encontra por album artist', () => {
    expect(matchesTrack(track({ albumArtist: 'Banda Eva' }), normalizeSearch('banda eva'))).toBe(true);
  });
});

describe('groupTracks', () => {
  it('não mistura álbuns de artistas diferentes com o mesmo nome', () => {
    const groups = groupTracks([
      track({ id: '1', artist: 'Artista A', albumArtist: 'Artista A', album: 'Greatest Hits' }),
      track({ id: '2', artist: 'Artista B', albumArtist: 'Artista B', album: 'Greatest Hits' })
    ], 'albums');

    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.subtitle)).toEqual(['Artista A', 'Artista B']);
  });

  it('mantém participações no mesmo álbum quando albumArtist é igual', () => {
    const groups = groupTracks([
      track({ id: '1', artist: 'Artista A', albumArtist: 'Artista A', album: 'Ao Vivo' }),
      track({ id: '2', artist: 'Artista A, Convidado', albumArtist: 'Artista A', album: 'Ao Vivo' })
    ], 'albums');

    expect(groups).toHaveLength(1);
    expect(groups[0].tracks).toHaveLength(2);
  });
});

describe('buildQueueContext', () => {
  it('usa o contexto selecionado como fila e mantém a posição correta', () => {
    const first = track({ id: '1', title: 'Primeira' });
    const second = track({ id: '2', title: 'Segunda' });
    const third = track({ id: '3', title: 'Terceira' });

    const result = buildQueueContext(second, [first, second, third]);

    expect(result.queue.map(item => item.id)).toEqual(['1', '2', '3']);
    expect(result.index).toBe(1);
  });
});
