import { describe, expect, it } from 'vitest';
import { buildTrackMetadataOverridePatch } from './admin-track-metadata';

const physical = {
  title: 'Título físico',
  artist: 'Artista físico',
  album: 'Álbum físico',
  albumArtist: 'Artista físico'
};

describe('buildTrackMetadataOverridePatch', () => {
  it('envia somente diferenças efetivas e transforma valores físicos em null', () => {
    expect(buildTrackMetadataOverridePatch(physical, {
      title: '  Título corrigido  ',
      artist: 'Artista físico',
      album: 'Álbum corrigido',
      albumArtist: 'Artista físico'
    })).toEqual({
      title: 'Título corrigido',
      artist: null,
      album: 'Álbum corrigido',
      albumArtist: null
    });
  });

  it('rejeita campo vazio antes da chamada HTTP', () => {
    expect(() => buildTrackMetadataOverridePatch(physical, {
      ...physical,
      title: '   '
    })).toThrow('title não pode ficar vazio.');
  });
});
