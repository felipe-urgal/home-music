import { readFileSync } from 'node:fs';
import type { Track } from '@home-music/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import type { OfflineDownloadRecord } from './offline-downloads';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

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
        onOpenPlayer={() => undefined}
        onTogglePlay={() => undefined}
        onNext={() => undefined}
        onPlayTrack={() => undefined}
        onRemove={() => undefined}
        onRemoveCollection={() => undefined}
        onExitOffline={() => undefined}
      />
    );

    expect(html).toContain('Tocar Faixa 99');
    expect(html).not.toContain('Tocar Faixa 100,');
    expect(html).toContain('Mostrar mais 100 músicas');
  });

  it('mantém o retorno aos downloads visível somente na superfície offline mobile', () => {
    const offlineApp = source('OfflineApp.tsx');
    const offlineCss = source('offline-mobile.css');
    const mobileCss = source('mobile-shell.css');

    expect(mobileCss).toMatch(/\.topbar__back-to-library\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/);
    expect(offlineApp).toMatch(/phone-surface--offline/);
    expect(offlineApp).toMatch(/libraryReturnLabel="Voltar aos downloads"/);
    expect(offlineCss).toMatch(/\.phone-surface--offline \.topbar__back-to-library\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/);
  });
});
