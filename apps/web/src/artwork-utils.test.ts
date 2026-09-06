import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import {
  ARTWORK_FALLBACK_VERSION,
  ARTWORK_TONE_COUNT,
  artworkFallbackDataUrl,
  artworkFallbackSvg,
  buildArtworkFallback,
  type ArtworkFallbackIdentity
} from './artwork-utils';

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
  it('mantém a mesma identidade visual versionada para faixas do mesmo álbum', () => {
    const first = buildArtworkFallback(track({ id: '1', title: 'Águas de Março' }));
    const second = buildArtworkFallback(track({ id: '2', title: 'Corcovado' }));

    expect(second).toEqual(first);
    expect(first.version).toBe(ARTWORK_FALLBACK_VERSION);
    expect(first.label).toBe('ET');
    expect(first.palette.surface).toMatch(/^#/);
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

  it('trata Unicode e texto longo de forma estável sem expandir a label', () => {
    const result = buildArtworkFallback(track({
      album: 'Álbum desconhecido',
      albumArtist: 'Artista desconhecido',
      artist: 'Artista desconhecido',
      title: 'É Tudo Muito Longo 🎧 com acentos e símbolos'
    }));

    expect(result.label).toBe('ÉT');
    expect(Array.from(result.label)).toHaveLength(2);
  });

  it('produz sempre um tom dentro da faixa suportada', () => {
    for (let index = 0; index < 50; index += 1) {
      const result = buildArtworkFallback(track({ id: String(index), album: `Álbum ${index}` }));
      expect(result.tone).toBeGreaterThanOrEqual(0);
      expect(result.tone).toBeLessThan(ARTWORK_TONE_COUNT);
    }
  });
});

describe('artwork fallback estático', () => {
  it('produz SVG determinístico a partir do mesmo descriptor', () => {
    const identity = buildArtworkFallback(track());

    expect(artworkFallbackSvg(identity)).toBe(artworkFallbackSvg(identity));
    expect(artworkFallbackSvg(identity)).toContain(`data-fallback-version="${ARTWORK_FALLBACK_VERSION}"`);
    expect(artworkFallbackSvg(identity)).toContain(identity.palette.surface);
    expect(artworkFallbackSvg(identity)).toContain('>ET</text>');
  });

  it('escapa texto antes de serializar SVG e limita dimensões', () => {
    const identity: ArtworkFallbackIdentity = {
      ...buildArtworkFallback(track()),
      label: '<&"\''
    };
    const svg = artworkFallbackSvg(identity, 5000);

    expect(svg).toContain('width="1024" height="1024"');
    expect(svg).toContain('&lt;&amp;&quot;&apos;');
    expect(svg).not.toContain('><&"\'</text>');
  });

  it('gera data URL local sem provider ou path físico', () => {
    const identity = buildArtworkFallback(track({ folderPath: '/segredo/fisico' }));
    const dataUrl = artworkFallbackDataUrl(identity, 256);
    const decoded = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decoded).toContain('width="256" height="256"');
    expect(decoded).not.toContain('/segredo/fisico');
  });
});
