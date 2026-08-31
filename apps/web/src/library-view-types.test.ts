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
  it('preserva todos os filtros quando o contexto é compatível', () => {
    expect(compatibleLibraryViewDefinition(definition, ['MP3', 'FLAC'], true)).toEqual(definition);
  });

  it('remove apenas o formato incompatível e preserva os demais filtros', () => {
    expect(compatibleLibraryViewDefinition(definition, ['MP3'], true)).toEqual({
      ...definition,
      format: 'all'
    });
  });

  it('volta apenas a ordenação para current quando o contexto não ordena faixas', () => {
    expect(compatibleLibraryViewDefinition(definition, ['FLAC'], false)).toEqual({
      ...definition,
      sort: 'current'
    });
  });

  it('preserva o filtro all mesmo em contexto sem formatos', () => {
    const allFormats = { ...definition, format: 'all' };
    expect(compatibleLibraryViewDefinition(allFormats, [], true)).toEqual(allFormats);
  });
});
