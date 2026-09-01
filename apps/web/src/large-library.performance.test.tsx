import { performance } from 'node:perf_hooks';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Track } from '@home-music/shared';
import { describe, expect, it } from 'vitest';
import { LibraryTrackRows } from './components/LibraryTrackRows';
import {
  applyTrackView,
  buildFolderView,
  normalizeSearch
} from './library-utils';
import { LIBRARY_PAGE_SIZE } from './useLibraryNavigation';

const TRACK_COUNT = 10_000;
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
  });
});
