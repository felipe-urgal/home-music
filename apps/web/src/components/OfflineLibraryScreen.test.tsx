import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Track } from '@home-music/shared';
import type { OfflineCollectionSummary, OfflineDownloadRecord } from '../offline-downloads';
import { OfflineLibraryScreen } from './OfflineLibraryScreen';

const tracks: Track[] = [
  {
    id: 'track-1',
    title: 'Faixa Um',
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Álbum',
    folderPath: 'Artista/Álbum',
    duration: 180,
    format: 'flac',
    hasCover: false
  },
  {
    id: 'track-2',
    title: 'Faixa Dois',
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Álbum',
    folderPath: 'Artista/Álbum',
    duration: 200,
    format: 'flac',
    hasCover: false
  }
];

const records: OfflineDownloadRecord[] = tracks.map((track, index) => ({
  track,
  size: 1024 * (index + 1),
  mimeType: 'audio/flac',
  downloadedAt: '2026-09-17T00:00:00.000Z'
}));

const collection: OfflineCollectionSummary = {
  key: 'playlist:reggae',
  reference: {
    kind: 'playlist',
    sourceId: 'reggae',
    name: 'Reggae',
    trackIds: ['track-1', 'track-2'],
    updatedAt: '2026-09-17T00:00:00.000Z'
  },
  totalCount: 2,
  downloadedCount: 2,
  downloadingCount: 0,
  status: 'available',
  error: null
};

function renderScreen() {
  return renderToStaticMarkup(
    <OfflineLibraryScreen
      records={records}
      collections={[collection]}
      individualTrackIds={new Set()}
      playing={false}
      hasNext={false}
      totalBytes={3072}
      tvState="disconnected"
      tvMessage={null}
      onTvConnect={vi.fn()}
      onTvDisconnect={vi.fn()}
      onOpenPlayer={vi.fn()}
      onTogglePlay={vi.fn()}
      onNext={vi.fn()}
      onPlayTrack={vi.fn()}
      onRemove={vi.fn()}
      onRemoveCollection={vi.fn()}
      onExitOffline={vi.fn()}
    />
  );
}

describe('OfflineLibraryScreen collections', () => {
  it('separa a ação de abrir a coleção da ação explícita de tocar tudo', () => {
    const html = renderScreen();
    const source = readFileSync(new URL('./OfflineLibraryScreen.tsx', import.meta.url), 'utf8');

    expect(html).toContain('aria-label="Abrir coleção offline Reggae"');
    expect(html).toContain('aria-label="Tocar coleção offline Reggae"');
    expect(source).toContain('setSelectedCollectionKey(collection.key)');
  });
});
