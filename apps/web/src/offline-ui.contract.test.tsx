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

  it('usa confirmação acessível e não descarta erros em remoções', () => {
    const screen = source('components/OfflineLibraryScreen.tsx');
    const app = source('OfflineApp.tsx');
    expect(screen).toContain('<ActionDialog');
    expect(screen).toContain('danger');
    expect(screen).toContain('setRemovalError(');
    expect(screen).toContain('busyKeys.has(');
    expect(screen).not.toContain('window.confirm(');
    expect(screen).toContain('Tentar conectar para continuar downloads');
    expect(screen).toContain('disponíveis ·');
    expect(app).toContain('onRemove={trackId => offline.remove(trackId)}');
    expect(app).toContain('onRemoveCollection={(kind, sourceId) => offline.removeCollection(kind, sourceId)}');
    expect(app).not.toContain('offline.remove(trackId).catch(() => undefined)');
  });

  it('retry de coleções usa a conta atual, apenas pendentes e checagem de referências', () => {
    const downloads = source('offline-downloads.ts');
    const app = source('OfflineApp.tsx');
    expect(downloads).toContain('const retryCollection = useCallback(');
    expect(downloads).toContain('const missingIds = reference.trackIds.filter(id => !available.has(id))');
    expect(downloads).toContain('activeUserIdRef.current !== ownerUserId');
    expect(downloads).toContain('latest?.trackIds.includes(track.id)');
    expect(app).toContain('offline.retryCollection(kind, sourceId)');
  });

  it('isola snapshots de cold start pela conta dona dos downloads', () => {
    const app = source('App.tsx');
    expect(app).toContain('coldStartSnapshot?.ownerUserId === offline.ownerUserId');
    expect(source('offline-downloads.ts')).toContain('ownerUserId: userId');
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
