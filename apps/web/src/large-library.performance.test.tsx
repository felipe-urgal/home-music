import { performance } from 'node:perf_hooks';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Track } from '@home-music/shared';
import { describe, expect, it } from 'vitest';
import { LibraryTrackRows } from './components/LibraryTrackRows';
import {
  buildLibraryNavigationIndex,
  getIndexedFolderView
} from './library-navigation-index';
import {
  applyTrackView,
  buildFolderView,
  normalizeSearch,
  type TrackViewOptions
} from './library-utils';
import { LIBRARY_PAGE_SIZE } from './useLibraryNavigation';

const TRACK_COUNT = 10_000;
const COMPARATIVE_TRACK_COUNTS = [10_000, 25_000] as const;
const COMPARATIVE_RUNS = 5;
const MAX_INDEXED_SEARCH_RATIO = 0.9;
const MAX_INDEXED_FOLDER_RATIO = 0.25;
const MEBIBYTE = 1024 * 1024;
const LIMITS = {
  payloadDecodeMs: 1_500,
  folderProjectionMs: 1_500,
  searchFilterSortMs: 1_500,
  renderFirstPageMs: 1_500,
  heapUsedMb: 768,
  rssMb: 1_536
};

type Measurement<T> = {
  value: T;
  durationMs: number;
  heapDeltaMb: number;
  heapUsedMb: number;
  rssMb: number;
};

function mb(bytes: number) {
  return Number((bytes / MEBIBYTE).toFixed(2));
}

function roundMs(value: number) {
  return Number(value.toFixed(2));
}

function measure<T>(operation: () => T): Measurement<T> {
  const before = process.memoryUsage();
  const startedAt = performance.now();
  const value = operation();
  const durationMs = performance.now() - startedAt;
  const after = process.memoryUsage();

  return {
    value,
    durationMs: roundMs(durationMs),
    heapDeltaMb: mb(after.heapUsed - before.heapUsed),
    heapUsedMb: mb(after.heapUsed),
    rssMb: mb(after.rss)
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measureMedianMs(operation: () => unknown) {
  operation();
  const durations = Array.from({ length: COMPARATIVE_RUNS }, () => {
    const startedAt = performance.now();
    operation();
    return performance.now() - startedAt;
  });
  return median(durations);
}

function syntheticTrack(index: number): Track {
  const formats = ['MP3', 'AAC', 'FLAC', 'OPUS'];
  const artistIndex = index % 200;
  const albumIndex = index % 500;
  const genreIndex = index % 12;
  const albumArtistIndex = artistIndex % 50;

  return {
    id: `track-${String(index).padStart(5, '0')}`,
    title: `Faixa ${String(index + 1).padStart(5, '0')}`,
    artist: `Artista ${String(artistIndex).padStart(3, '0')}`,
    album: `Álbum ${String(albumIndex).padStart(3, '0')}`,
    albumArtist: `Artista do álbum ${String(albumArtistIndex).padStart(2, '0')}`,
    folder: `Gênero ${String(genreIndex).padStart(2, '0')}`,
    folderPath: `Gênero ${String(genreIndex).padStart(2, '0')}/Artista ${String(artistIndex).padStart(3, '0')}/Álbum ${String(albumIndex).padStart(3, '0')}`,
    duration: 90 + (index % 420),
    format: formats[index % formats.length],
    hasCover: index % 3 !== 0,
    replayGainTrackDb: -6 + (index % 12) / 2,
    replayGainAlbumDb: -5 + (index % 10) / 2
  };
}

function assertWithin(label: string, actual: number, limit: number, unit: string) {
  expect(actual, `${label}: ${actual}${unit} > ${limit}${unit}`).toBeLessThanOrEqual(limit);
}

function comparativeSearchCases(): TrackViewOptions[] {
  return ['artista 042', 'album 123', 'genero 06'].map(query => ({
    normalizedQuery: normalizeSearch(query),
    format: 'all',
    cover: 'all',
    sort: 'current'
  }));
}

describe('large library performance guard', () => {
  it('keeps library loading, navigation and first-page rendering within grave-regression limits', () => {
    const sourceTracks = Array.from({ length: TRACK_COUNT }, (_, index) => syntheticTrack(index));
    const serializedTracks = JSON.stringify(sourceTracks);

    const payloadDecode = measure(() => JSON.parse(serializedTracks) as Track[]);
    expect(payloadDecode.value).toHaveLength(TRACK_COUNT);

    const folderProjection = measure(() => buildFolderView(payloadDecode.value, ''));
    expect(folderProjection.value.allTracks).toHaveLength(TRACK_COUNT);
    expect(folderProjection.value.folders.length).toBeGreaterThan(0);

    const searchFilterSort = measure(() => applyTrackView(payloadDecode.value, {
      normalizedQuery: normalizeSearch('artista 042'),
      format: 'FLAC',
      cover: 'all',
      sort: 'artist-asc'
    }));
    expect(searchFilterSort.value.length).toBeGreaterThan(0);
    expect(searchFilterSort.value.every(track => track.format === 'FLAC')).toBe(true);

    const firstPage = payloadDecode.value.slice(0, LIBRARY_PAGE_SIZE);
    const renderFirstPage = measure(() => renderToStaticMarkup(
      <LibraryTrackRows
        tracks={firstPage}
        context={payloadDecode.value}
        playing={false}
        sort="current"
        onSort={() => undefined}
        onPlayTrack={() => undefined}
        offlineSupported={false}
        downloadedIds={new Set<string>()}
        individualDownloadedIds={new Set<string>()}
        collectionDownloadedIds={new Set<string>()}
        downloadingIds={new Set<string>()}
        onDownload={async () => undefined}
        onRemoveDownload={async () => undefined}
      />
    ));
    expect(renderFirstPage.value).toContain('library-track-list');
    expect(firstPage).toHaveLength(LIBRARY_PAGE_SIZE);

    assertWithin('decode do payload', payloadDecode.durationMs, LIMITS.payloadDecodeMs, 'ms');
    assertWithin('projeção de pastas', folderProjection.durationMs, LIMITS.folderProjectionMs, 'ms');
    assertWithin('busca/filtro/ordenação', searchFilterSort.durationMs, LIMITS.searchFilterSortMs, 'ms');
    assertWithin('renderização SSR da primeira página', renderFirstPage.durationMs, LIMITS.renderFirstPageMs, 'ms');

    const memorySamples = [payloadDecode, folderProjection, searchFilterSort, renderFirstPage];
    const maxHeapUsedMb = Math.max(...memorySamples.map(sample => sample.heapUsedMb));
    const maxRssMb = Math.max(...memorySamples.map(sample => sample.rssMb));
    assertWithin('heap usado', maxHeapUsedMb, LIMITS.heapUsedMb, 'MB');
    assertWithin('RSS', maxRssMb, LIMITS.rssMb, 'MB');

    console.log(JSON.stringify({
      benchmark: 'large-library-web',
      dataset: {
        tracks: TRACK_COUNT,
        visibleTracks: LIBRARY_PAGE_SIZE,
        serializedPayloadMb: mb(Buffer.byteLength(serializedTracks))
      },
      measurements: {
        payloadDecode: {
          durationMs: payloadDecode.durationMs,
          heapDeltaMb: payloadDecode.heapDeltaMb
        },
        folderProjection: {
          durationMs: folderProjection.durationMs,
          heapDeltaMb: folderProjection.heapDeltaMb
        },
        searchFilterSort: {
          durationMs: searchFilterSort.durationMs,
          results: searchFilterSort.value.length,
          heapDeltaMb: searchFilterSort.heapDeltaMb
        },
        renderFirstPage: {
          durationMs: renderFirstPage.durationMs,
          markupKb: Number((Buffer.byteLength(renderFirstPage.value) / 1024).toFixed(2)),
          heapDeltaMb: renderFirstPage.heapDeltaMb
        },
        memory: {
          maxHeapUsedMb,
          maxRssMb
        }
      },
      regressionLimits: LIMITS
    }, null, 2));
  }, 10_000);

  it('proves indexed navigation improves repeated 10k/25k interactions against the legacy path', () => {
    const reports = COMPARATIVE_TRACK_COUNTS.map(trackCount => {
      const tracks = Array.from({ length: trackCount }, (_, index) => syntheticTrack(index));
      const indexBuild = measure(() => buildLibraryNavigationIndex(tracks));
      const navigationIndex = indexBuild.value;
      const searchCases = comparativeSearchCases();
      const samplePath = syntheticTrack(42).folderPath;
      const [genre, artist] = samplePath.split('/');
      const folderPaths = ['', genre, `${genre}/${artist}`, samplePath];

      const legacySearch = () => searchCases.reduce(
        (total, options) => total + applyTrackView(tracks, options).length,
        0
      );
      const indexedSearch = () => searchCases.reduce(
        (total, options) => total + applyTrackView(
          tracks,
          options,
          navigationIndex.searchTextByTrackId
        ).length,
        0
      );
      const legacyFolderNavigation = () => folderPaths.reduce(
        (total, path) => total + buildFolderView(tracks, path).allTracks.length,
        0
      );
      const indexedFolderNavigation = () => folderPaths.reduce(
        (total, path) => total + getIndexedFolderView(navigationIndex, path).allTracks.length,
        0
      );

      expect(indexedSearch()).toBe(legacySearch());
      expect(indexedFolderNavigation()).toBe(legacyFolderNavigation());

      const legacySearchMedianMs = measureMedianMs(legacySearch);
      const indexedSearchMedianMs = measureMedianMs(indexedSearch);
      const legacyFolderMedianMs = measureMedianMs(legacyFolderNavigation);
      const indexedFolderMedianMs = measureMedianMs(indexedFolderNavigation);

      expect(
        indexedSearchMedianMs,
        `busca indexada ${trackCount}: ${roundMs(indexedSearchMedianMs)}ms deve ser <= ${MAX_INDEXED_SEARCH_RATIO * 100}% do legado (${roundMs(legacySearchMedianMs)}ms)`
      ).toBeLessThanOrEqual(legacySearchMedianMs * MAX_INDEXED_SEARCH_RATIO);
      expect(
        indexedFolderMedianMs,
        `navegação de pastas indexada ${trackCount}: ${roundMs(indexedFolderMedianMs)}ms deve ser <= ${MAX_INDEXED_FOLDER_RATIO * 100}% do legado (${roundMs(legacyFolderMedianMs)}ms)`
      ).toBeLessThanOrEqual(legacyFolderMedianMs * MAX_INDEXED_FOLDER_RATIO);

      return {
        tracks: trackCount,
        runsPerMeasurement: COMPARATIVE_RUNS,
        indexBuild: {
          durationMs: indexBuild.durationMs,
          heapDeltaMb: indexBuild.heapDeltaMb,
          stats: navigationIndex.stats
        },
        repeatedSearch: {
          legacyMedianMs: roundMs(legacySearchMedianMs),
          indexedMedianMs: roundMs(indexedSearchMedianMs),
          indexedToLegacyRatio: Number((indexedSearchMedianMs / legacySearchMedianMs).toFixed(3)),
          minimumImprovementPercent: (1 - MAX_INDEXED_SEARCH_RATIO) * 100
        },
        folderNavigation: {
          legacyMedianMs: roundMs(legacyFolderMedianMs),
          indexedMedianMs: roundMs(indexedFolderMedianMs),
          indexedToLegacyRatio: Number((indexedFolderMedianMs / legacyFolderMedianMs).toFixed(3)),
          minimumImprovementPercent: (1 - MAX_INDEXED_FOLDER_RATIO) * 100
        }
      };
    });

    console.log(JSON.stringify({
      benchmark: 'library-navigation-index-comparison',
      methodology: 'same-process median after one warm-up; legacy and indexed paths use identical synthetic datasets and interactions',
      reports
    }, null, 2));
  }, 20_000);
});
