import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { ARTWORK_TONE_COUNT, buildArtworkFallback } from './artwork-utils';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: '1',
    title: 'Águas de Março',
    artist: 'Elis Regina',
    album: 'Elis & Tom',
    albumArtist: 'Elis Regina & Tom Jobim',
    folder: 'MPB',
    folderPath: 'MPB',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    ...overrides
  };
}

describe('buildArtworkFallback', () => {
  it('mantém a mesma identidade visual para faixas do mesmo álbum', () => {
    const first = buildArtworkFallback(track({ id: '1', title: 'Águas de Março' }));
    const second = buildArtworkFallback(track({ id: '2', title: 'Corcovado' }));

    expect(second).toEqual(first);
    expect(first.label).toBe('ET');
  });

  it('usa o artista quando o álbum é desconhecido', () => {
    const result = buildArtworkFallback(track({
      album: 'Álbum desconhecido',
      albumArtist: 'Milton Nascimento',
      artist: 'Milton Nascimento'
    }));

    expect(result.label).toBe('MN');
  });

  it('usa o título quando álbum e artista são desconhecidos', () => {
    const result = buildArtworkFallback(track({
      album: 'Álbum desconhecido',
      albumArtist: 'Artista desconhecido',
      artist: 'Artista desconhecido',
      title: 'Águas de Março'
    }));

    expect(result.label).toBe('ÁD');
  });

  it('produz sempre um tom dentro da faixa suportada', () => {
    for (let index = 0; index < 50; index += 1) {
      const result = buildArtworkFallback(track({ id: String(index), album: `Álbum ${index}` }));
      expect(result.tone).toBeGreaterThanOrEqual(0);
      expect(result.tone).toBeLessThan(ARTWORK_TONE_COUNT);
    }
  });
});
