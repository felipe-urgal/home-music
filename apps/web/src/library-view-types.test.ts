import { describe, expect, it } from 'vitest';
import {
  compatibleLibraryViewDefinition,
  type LibraryViewDefinition
} from './library-view-types';

const definition: LibraryViewDefinition = {
  query: 'house',
  format: 'FLAC',
  cover: 'with-cover',
  sort: 'artist-asc'
};

describe('compatibleLibraryViewDefinition', () => {
  it('preserva todos os filtros quando o formato existe no contexto', () => {
    expect(compatibleLibraryViewDefinition(definition, ['MP3', 'FLAC'])).toEqual(definition);
  });

  it('remove apenas o formato incompatível e preserva os demais filtros', () => {
    expect(compatibleLibraryViewDefinition(definition, ['MP3'])).toEqual({
      ...definition,
      format: 'all'
    });
  });

  it('preserva o filtro all mesmo em contexto sem formatos', () => {
    const allFormats = { ...definition, format: 'all' };
    expect(compatibleLibraryViewDefinition(allFormats, [])).toEqual(allFormats);
  });
});
