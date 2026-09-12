import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { filterTvRemoteTracks } from './tv-remote-library-picker';

function track(id: string, title: string, artist: string, album: string): Track {
  return {
    id, title, artist, album, albumArtist: artist, folder: 'Music', folderPath: 'Music',
    duration: 180, format: 'mp3', hasCover: false
  };
}

describe('filterTvRemoteTracks', () => {
  const tracks = [
    track('1', 'Midnight City', 'M83', 'Hurry Up, We’re Dreaming'),
    track('2', 'Instant Crush', 'Daft Punk', 'Random Access Memories'),
    track('3', 'Digital Love', 'Daft Punk', 'Discovery')
  ];

  it('busca por título, artista e álbum sem diferenciar maiúsculas', () => {
    expect(filterTvRemoteTracks(tracks, 'midnight').map(item => item.id)).toEqual(['1']);
    expect(filterTvRemoteTracks(tracks, 'DAFT PUNK').map(item => item.id)).toEqual(['2', '3']);
    expect(filterTvRemoteTracks(tracks, 'discovery').map(item => item.id)).toEqual(['3']);
  });

  it('mostra a biblioteca na ordem atual quando a busca está vazia', () => {
    expect(filterTvRemoteTracks(tracks, '').map(item => item.id)).toEqual(['1', '2', '3']);
  });

  it('limita a lista renderizada para manter o controle ágil em bibliotecas grandes', () => {
    const many = Array.from({ length: 55 }, (_, index) => track(String(index), `Faixa ${index}`, 'Artista', 'Álbum'));
    expect(filterTvRemoteTracks(many, '')).toHaveLength(40);
  });
});
