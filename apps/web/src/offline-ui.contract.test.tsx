import type { Track } from '@home-music/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import type { OfflineDownloadRecord } from './offline-downloads';

function record(index: number): OfflineDownloadRecord {
  const track: Track = {
    id: `track-${index}`,
    title: `Faixa ${index}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Coleção',
    folderPath: 'Coleção',
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
  return {
    track,
    size: 9_000_000,
    mimeType: 'audio/mpeg',
    downloadedAt: '2026-09-11T12:00:00.000Z'
  };
}

describe('offline library UX contract', () => {
  it('renderiza somente a primeira página de uma biblioteca offline grande', () => {
    const records = Array.from({ length: 1_000 }, (_value, index) => record(index));
    const individualTrackIds = new Set(records.map(item => item.track.id));
    const html = renderToStaticMarkup(
      <OfflineLibraryScreen
        records={records}
        collections={[]}
        individualTrackIds={individualTrackIds}
        playing={false}
        hasNext={false}
        totalBytes={records.reduce((total, item) => total + item.size, 0)}
        tvState="disconnected"
        tvMessage={null}
        onTvConnect={() => undefined}
        onTvDisconnect={() => undefined}
        onOpenPlayer={() => undefined}
        onTogglePlay={() => undefined}
        onNext={() => undefined}
        onPlayTrack={() => undefined}
        onRemove={async () => undefined}
        onRemoveCollection={async () => undefined}
        onExitOffline={() => undefined}
      />
    );

    expect(html).toContain('Conectar à TV');
    expect(html).toContain('Tocar Faixa 99');
    expect(html).not.toContain('Tocar Faixa 100,');
    expect(html).toContain('Mostrar mais 100 músicas');
  });
});
