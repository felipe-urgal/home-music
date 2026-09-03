import type { Track } from '@home-music/shared';
import { describe, expect, it } from 'vitest';
import {
  buildLibraryNavigationIndex,
  getIndexedFolderView,
  shouldRebuildLibraryNavigationIndex,
  type LibraryNavigationIndexCache
} from './library-navigation-index';
import {
  applyTrackView,
  buildFolderView,
  normalizeSearch,
  type TrackViewOptions
} from './library-utils';

function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista do álbum',
    folder: 'Biblioteca',
    folderPath: 'Biblioteca/Artista/Álbum',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    ...overrides
  };
}

const fixtureTracks: Track[] = [
  makeTrack('1', {
    title: 'Água de Março',
    artist: 'Elis Regina',
    album: 'Elis & Tom',
    albumArtist: 'Elis Regina e Tom Jobim',
    folder: 'MPB',
    folderPath: 'MPB/Elis Regina/Elis & Tom',
    format: 'FLAC',
    hasCover: true
  }),
  makeTrack('2', {
    title: 'Corcovado',
    artist: 'Tom Jobim',
    album: 'Wave',
    albumArtist: 'Tom Jobim',
    folder: 'MPB',
    folderPath: 'MPB/Tom Jobim/Wave',
    format: 'AAC'
  }),
  makeTrack('3', {
    title: 'Intro',
    artist: 'Banda Raiz',
    album: 'Ao vivo',
    albumArtist: 'Banda Raiz',
    folder: 'Rock',
    folderPath: 'Rock',
    format: 'MP3'
  }),
  makeTrack('4', {
    title: 'Noite Elétrica',
    artist: 'Banda Raiz',
    album: 'Ao vivo',
    albumArtist: 'Banda Raiz',
    folder: 'Rock',
    folderPath: 'Rock/Banda Raiz/Ao vivo',
    format: 'FLAC',
    hasCover: true
  })
];

describe('library navigation index', () => {
  it('preserves folder projections from the canonical helpers', () => {
    const index = buildLibraryNavigationIndex(fixtureTracks);

    for (const folderPath of ['', 'MPB', 'MPB/Elis Regina', 'Rock', 'Rock/Banda Raiz', 'inexistente']) {
      expect(getIndexedFolderView(index, folderPath)).toEqual(buildFolderView(fixtureTracks, folderPath));
    }

    expect(index.trackMap.get('1')).toBe(fixtureTracks[0]);
    expect(index.formatsByFolderPath.get('MPB')).toEqual(['AAC', 'FLAC']);
  });

  it('returns the same search, filter and sort results with precomputed search text', () => {
    const index = buildLibraryNavigationIndex(fixtureTracks);
    const cases: TrackViewOptions[] = [
      {
        normalizedQuery: '',
        format: 'all',
        cover: 'all',
        sort: 'current'
      },
      {
        normalizedQuery: normalizeSearch('agua de marco'),
        format: 'FLAC',
        cover: 'with-cover',
        sort: 'title-asc'
      },
      {
        normalizedQuery: normalizeSearch('banda raiz'),
        format: 'all',
        cover: 'all',
        sort: 'album-desc'
      }
    ];

    for (const options of cases) {
      const expected = applyTrackView(fixtureTracks, options);
      const indexed = applyTrackView(fixtureTracks, options, index.searchTextByTrackId);
      expect(indexed.map(track => track.id)).toEqual(expected.map(track => track.id));
    }
  });

  it('invalidates by revision and falls back to track identity when revision is unavailable', () => {
    const index = buildLibraryNavigationIndex(fixtureTracks);
    const cache: LibraryNavigationIndexCache = {
      revision: 7,
      tracks: fixtureTracks,
      index
    };

    expect(shouldRebuildLibraryNavigationIndex(cache, fixtureTracks, 7)).toBe(false);
    expect(shouldRebuildLibraryNavigationIndex(cache, [...fixtureTracks], 7)).toBe(false);
    expect(shouldRebuildLibraryNavigationIndex(cache, fixtureTracks, 8)).toBe(true);

    const fallbackCache: LibraryNavigationIndexCache = {
      revision: 0,
      tracks: fixtureTracks,
      index
    };
    expect(shouldRebuildLibraryNavigationIndex(fallbackCache, fixtureTracks, 0)).toBe(false);
    expect(shouldRebuildLibraryNavigationIndex(fallbackCache, [...fixtureTracks], 0)).toBe(true);
  });

  it('keeps additional folder references bounded by snapshot size and path depth', () => {
    const tracks = Array.from({ length: 100 }, (_, index) => makeTrack(String(index), {
      folderPath: `Gênero ${index % 5}/Artista ${index % 20}/Álbum ${index % 40}`,
      format: index % 2 ? 'FLAC' : 'MP3'
    }));
    const navigationIndex = buildLibraryNavigationIndex(tracks);
    const { stats } = navigationIndex;

    expect(stats.trackCount).toBe(tracks.length);
    expect(stats.searchEntryCount).toBe(tracks.length);
    expect(stats.maxFolderDepth).toBe(3);
    expect(stats.folderTrackReferences).toBeLessThanOrEqual(
      tracks.length * (stats.maxFolderDepth + 2)
    );
  });
});
