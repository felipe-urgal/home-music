import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import {
  applyTrackView,
  buildFolderView,
  buildLibraryReturnLabel,
  buildQueueContext,
  groupTracks,
  matchesTrack,
  matchesTrackView,
  normalizeIdentity,
  normalizeSearch,
  sortTracks,
  type LibraryReturnContext,
  type TrackViewOptions
} from './library-utils';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: '1',
    title: 'Festa',
    artist: 'Ivete Sangalo',
    album: 'Festa',
    albumArtist: 'Ivete Sangalo',
    folder: 'Axé',
    folderPath: 'Axé',
    duration: 180,
    format: 'MP3',
    hasCover: true,
    ...overrides
  };
}

function viewOptions(overrides: Partial<TrackViewOptions> = {}): TrackViewOptions {
  return {
    normalizedQuery: '',
    format: 'all',
    favorite: 'all',
    cover: 'all',
    sort: 'current',
    favoriteIds: new Set<string>(),
    ...overrides
  };
}

describe('normalização', () => {
  it('busca ignora acentos e caixa', () => {
    expect(normalizeSearch('  AxÉ  ')).toBe('axe');
  });

  it('identidade preserva acentos', () => {
    expect(normalizeIdentity('Axé')).not.toBe(normalizeIdentity('Axe'));
  });
});

describe('matchesTrack', () => {
  it('encontra por pasta sem exigir acento', () => {
    expect(matchesTrack(track(), normalizeSearch('axe'))).toBe(true);
  });

  it('encontra por subpasta', () => {
    expect(matchesTrack(track({ folderPath: 'Rock Internacional/Queen' }), normalizeSearch('queen'))).toBe(true);
  });

  it('encontra por album artist', () => {
    expect(matchesTrack(track({ albumArtist: 'Banda Eva' }), normalizeSearch('banda eva'))).toBe(true);
  });
});

describe('filtros e ordenação da biblioteca', () => {
  it('combina busca, formato, favorito e capa', () => {
    const item = track({ id: 'flac', title: 'Águas de Março', format: 'FLAC', hasCover: false });
    const options = viewOptions({
      normalizedQuery: normalizeSearch('aguas'),
      format: 'FLAC',
      favorite: 'favorites',
      cover: 'without-cover',
      favoriteIds: new Set(['flac'])
    });

    expect(matchesTrackView(item, options)).toBe(true);
    expect(matchesTrackView(item, { ...options, format: 'MP3' })).toBe(false);
    expect(matchesTrackView(item, { ...options, favorite: 'not-favorites' })).toBe(false);
    expect(matchesTrackView(item, { ...options, cover: 'with-cover' })).toBe(false);
  });

  it('preserva a ordem atual sem mutar a origem', () => {
    const source = [
      track({ id: '3', title: 'Terceira' }),
      track({ id: '1', title: 'Primeira' }),
      track({ id: '2', title: 'Segunda' })
    ];

    const result = applyTrackView(source, viewOptions());
    expect(result.map(item => item.id)).toEqual(['3', '1', '2']);
    expect(result).not.toBe(source);
  });

  it('ordena título, artista e álbum de forma previsível', () => {
    const source = [
      track({ id: '1', title: 'Zebra', artist: 'B', album: 'Dois' }),
      track({ id: '2', title: 'Água', artist: 'C', album: 'Um' }),
      track({ id: '3', title: 'Casa', artist: 'A', album: 'Três' })
    ];

    expect(sortTracks(source, 'title-asc').map(item => item.id)).toEqual(['2', '3', '1']);
    expect(sortTracks(source, 'title-desc').map(item => item.id)).toEqual(['1', '3', '2']);
    expect(sortTracks(source, 'artist-asc').map(item => item.id)).toEqual(['3', '1', '2']);
    expect(sortTracks(source, 'album-asc').map(item => item.id)).toEqual(['1', '3', '2']);
  });

  it('mantém somente não favoritos quando solicitado', () => {
    const source = [track({ id: '1' }), track({ id: '2', title: 'Outra' })];
    const result = applyTrackView(source, viewOptions({
      favorite: 'not-favorites',
      favoriteIds: new Set(['1'])
    }));

    expect(result.map(item => item.id)).toEqual(['2']);
  });
});

describe('buildLibraryReturnLabel', () => {
  const base = {
    selectedGroupName: null,
    selectedPlaylistName: null,
    libraryTab: 'folders',
    folderPath: '',
    folderName: 'Pastas',
    query: ''
  } satisfies LibraryReturnContext;

  it('retorna para a pasta atual', () => {
    expect(buildLibraryReturnLabel({
      ...base,
      folderPath: 'Axé',
      folderName: 'Axé'
    })).toBe('Voltar para Axé');
  });

  it('preserva o contexto de busca dentro de uma coleção', () => {
    expect(buildLibraryReturnLabel({
      ...base,
      selectedGroupName: 'Raul Seixas',
      libraryTab: 'artists',
      query: 'tente'
    })).toBe('Voltar para busca em Raul Seixas');
  });

  it('identifica busca na raiz', () => {
    expect(buildLibraryReturnLabel({ ...base, query: 'queen' })).toBe('Voltar para resultados da busca');
  });

  it('usa biblioteca na raiz sem busca', () => {
    expect(buildLibraryReturnLabel(base)).toBe('Voltar à biblioteca');
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

  it('não mistura pastas que diferem apenas por acento', () => {
    const groups = groupTracks([
      track({ id: '1', folder: 'Axé', folderPath: 'Axé' }),
      track({ id: '2', folder: 'Axe', folderPath: 'Axe' })
    ], 'folders');

    expect(groups).toHaveLength(2);
  });
});

describe('buildFolderView', () => {
  const tracks = [
    track({ id: '1', title: 'Back In Black', folder: 'Rock Internacional', folderPath: 'Rock Internacional/AC-DC' }),
    track({ id: '2', title: 'Bohemian Rhapsody', folder: 'Rock Internacional', folderPath: 'Rock Internacional/Queen' }),
    track({ id: '3', title: 'Outra', folder: 'Rock Internacional', folderPath: 'Rock Internacional/Queen/Ao Vivo' }),
    track({ id: '4', title: 'Raiz', folder: 'Rock Internacional', folderPath: 'Rock Internacional' })
  ];

  it('monta filhos imediatos sem perder subpastas', () => {
    const view = buildFolderView(tracks, 'Rock Internacional');
    expect(view.folders.map(folder => folder.name)).toEqual(['AC-DC', 'Queen']);
    expect(view.directTracks.map(item => item.id)).toEqual(['4']);
    expect(view.allTracks).toHaveLength(4);
  });

  it('gera parent e breadcrumbs seguros', () => {
    const view = buildFolderView(tracks, 'Rock Internacional/Queen');
    expect(view.parentPath).toBe('Rock Internacional');
    expect(view.breadcrumbs).toEqual([
      { name: 'Rock Internacional', path: 'Rock Internacional' },
      { name: 'Queen', path: 'Rock Internacional/Queen' }
    ]);
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
