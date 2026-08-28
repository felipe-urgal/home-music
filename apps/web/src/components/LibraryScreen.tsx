import {
  ChevronLeft,
  ChevronRight,
  Folder,
  ListMusic,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react';
import type { AuthenticatedUser, Playlist, Track } from '@home-music/shared';
import { canUseAdminLibraryActions } from '../frontend-access';
import type { TrackSort } from '../library-utils';
import type { OfflineDownloads } from '../offline-downloads';
import type { LibraryData } from '../useLibraryData';
import { useDesktopLayout } from '../useDesktopLayout';
import { LIBRARY_PAGE_SIZE, type LibraryNavigation, type LibraryTab } from '../useLibraryNavigation';
import { Artwork } from './Artwork';
import { DesktopTrackTable } from './DesktopTrackTable';
import { MiniPlayer } from './MiniPlayer';

type LibraryOfflineDownloads = Pick<OfflineDownloads, 'supported' | 'downloadedIds' | 'downloadingIds' | 'download' | 'remove'>;

type LibraryScreenProps = {
  currentUser: AuthenticatedUser;
  data: LibraryData;
  offline: LibraryOfflineDownloads;
  current?: Track;
  playing: boolean;
  hasNext: boolean;
  currentTime: number;
  duration: number;
  navigation: LibraryNavigation;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
};

const tabs: Array<{ id: LibraryTab; label: string; icon: typeof Folder }> = [
  { id: 'folders', label: 'Pastas', icon: Folder },
  { id: 'playlists', label: 'Playlists', icon: ListMusic }
];

function TrackRows({
  tracks,
  context,
  current,
  playing,
  sort,
  onSort,
  onPlayTrack,
  onRemove,
  offlineSupported,
  downloadedIds,
  downloadingIds,
  onDownload,
  onRemoveDownload
}: {
  tracks: Track[];
  context: Track[];
  current?: Track;
  playing: boolean;
  sort: TrackSort;
  onSort: (sort: TrackSort) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onRemove?: (trackId: string) => void;
  offlineSupported: boolean;
  downloadedIds: ReadonlySet<string>;
  downloadingIds: ReadonlySet<string>;
  onDownload: (track: Track) => Promise<void>;
  onRemoveDownload: (track: Track) => Promise<void>;
}) {
  const isDesktop = useDesktopLayout();

  if (isDesktop) {
    return (
      <DesktopTrackTable
        tracks={tracks}
        context={context}
        current={current}
        playing={playing}
        sort={sort}
        onSort={onSort}
        onPlayTrack={onPlayTrack}
        onRemove={onRemove}
        offlineSupported={offlineSupported}
        downloadedIds={downloadedIds}
        downloadingIds={downloadingIds}
        onDownload={onDownload}
        onRemoveDownload={onRemoveDownload}
      />
    );
  }

  return (
    <div className="library-track-list">
      {tracks.map(track => {
        const isCurrent = track.id === current?.id;
        return (
          <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
            <button className="library-track__main" onClick={() => onPlayTrack(track, context)}>
              <Artwork track={track} />
              <span className="library-track__text">
                <strong>{track.title}</strong>
                <small>{track.artist} · {track.album}</small>
              </span>
              {isCurrent && playing ? <span className="playing-indicator">▶</span> : <Play className="library-track__action" />}
            </button>
            {onRemove && (
              <button className="track-action" aria-label="Remover da playlist" onClick={() => onRemove(track.id)}><Trash2 /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LibraryScreen({
  currentUser,
  data,
  offline,
  current,
  playing,
  hasNext,
  currentTime,
  duration,
  navigation,
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onPlayTrack
}: LibraryScreenProps) {
  const canManageSharedLibrary = canUseAdminLibraryActions(currentUser);
  const {
    tracks,
    playlists,
    scanning,
    scannedAt,
    rescan,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    setPlaylistTracks,
    reportError
  } = data;
  const {
    libraryTab,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    sort,
    visibleCount,
    visibleFolders,
    libraryTracks,
    shouldShowTracks,
    pagedTracks,
    pagedFolders,
    selectTab,
    enterFolder,
    leaveFolder,
    selectPlaylist,
    leavePlaylist,
    changeSort,
    showMore
  } = navigation;

  const isDetail = Boolean(selectedPlaylist || folderPath);
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);

  function goBack() {
    if (selectedPlaylist) leavePlaylist();
    else if (folderPath) leaveFolder();
  }

  function title() {
    if (selectedPlaylist) return selectedPlaylist.name;
    if (libraryTab === 'folders' && folderPath) return folderView.name;
    return 'Biblioteca';
  }

  function subtitle() {
    if (selectedPlaylist) return `${libraryTracks.length} músicas`;
    if (libraryTab === 'folders' && folderPath) return `${folderContextTracks.length} músicas`;
    return `${tracks.length} músicas`;
  }

  async function makePlaylist() {
    const name = window.prompt('Nome da nova playlist:')?.trim();
    if (name) await createPlaylist(name);
  }

  async function editPlaylist(playlist: Playlist) {
    const name = window.prompt('Novo nome da playlist:', playlist.name)?.trim();
    if (name && name !== playlist.name) await renamePlaylist(playlist.id, name);
  }

  async function removePlaylist(playlist: Playlist) {
    if (window.confirm(`Excluir a playlist “${playlist.name}”?`)) {
      await deletePlaylist(playlist.id);
      leavePlaylist();
    }
  }

  async function scanNow() {
    try {
      const result = await rescan();
      window.alert(`Biblioteca atualizada: +${result.added} novas, ${result.updated} alteradas, ${result.removed} removidas.`);
    } catch {
      // useLibraryData já exibe o erro globalmente.
    }
  }

  async function downloadTrack(track: Track) {
    try {
      await offline.download(track);
    } catch (error) {
      reportError(error);
    }
  }

  async function removeTrackDownload(track: Track) {
    if (!window.confirm(`Remover “${track.title}” dos downloads offline?`)) return;
    try {
      await offline.remove(track.id);
    } catch (error) {
      reportError(error);
    }
  }

  const offlineTrackProps = {
    offlineSupported: offline.supported,
    downloadedIds: offline.downloadedIds,
    downloadingIds: offline.downloadingIds,
    onDownload: downloadTrack,
    onRemoveDownload: removeTrackDownload
  };

  return (
    <>
      <header className={`library-header ${isDetail ? 'is-detail' : 'is-root'}`}>
        {isDetail ? (
          <button className="icon-button" aria-label="Voltar" onClick={goBack}><ChevronLeft /></button>
        ) : (
          <span className="library-header__spacer" />
        )}
        <div className="library-header__title">
          <strong>{title()}</strong>
          <small>{subtitle()}</small>
        </div>
        {canManageSharedLibrary && (
          <button className={`icon-button ${scanning ? 'is-loading' : ''}`} aria-label="Atualizar biblioteca" disabled={scanning} onClick={() => void scanNow()}><RefreshCw /></button>
        )}
        <button className="icon-button library-header__player-button" aria-label="Voltar ao player" onClick={onOpenPlayer}><Music2 /></button>
      </header>

      {libraryTab === 'folders' && folderView.breadcrumbs.length > 0 && (
        <nav className="breadcrumbs" aria-label="Caminho da pasta">
          <button onClick={() => enterFolder('')}>Pastas</button>
          {folderView.breadcrumbs.map(crumb => (
            <span key={crumb.path}><ChevronRight /><button onClick={() => enterFolder(crumb.path)}>{crumb.name}</button></span>
          ))}
        </nav>
      )}

      {!isDetail && (
        <nav className="library-tabs" aria-label="Navegação da biblioteca">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={libraryTab === tab.id ? 'is-active' : ''} onClick={() => selectTab(tab.id)}>
                <Icon />{tab.label}
              </button>
            );
          })}
        </nav>
      )}

      <section className="library-content">
        {libraryTab === 'folders' ? (
          <>
            {folderContextTracks.length > 0 && folderPath && (
              <button className="play-all" onClick={() => onPlayTrack(folderContextTracks[0], folderContextTracks)}><Play />Tocar tudo <span>{folderContextTracks.length}</span></button>
            )}

            {pagedFolders.length > 0 && (
              <>
                <div className={`section-heading ${!folderPath ? 'section-heading--folders-root' : ''}`}><span>Pastas</span><small>{visibleFolders.length}</small></div>
                <div className="group-list">
                  {pagedFolders.map(folder => (
                    <button className="group-item" key={folder.path} onClick={() => enterFolder(folder.path)}>
                      <Artwork track={folder.artwork} />
                      <span className="group-item__text"><strong>{folder.name}</strong><small>{folder.matchingTrackCount} músicas</small></span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              </>
            )}

            {pagedTracks.length > 0 && (
              <>
                <div className="section-heading"><span>Músicas nesta pasta</span><small>{libraryTracks.length}</small></div>
                <TrackRows
                  tracks={pagedTracks}
                  context={folderContextTracks}
                  current={current}
                  playing={playing}
                  sort={sort}
                  onSort={changeSort}
                  onPlayTrack={onPlayTrack}
                  {...offlineTrackProps}
                />
              </>
            )}

            {!pagedFolders.length && !pagedTracks.length && <div className="empty-library">Nenhum item encontrado nesta pasta.</div>}

            {visibleCount < Math.max(visibleFolders.length, libraryTracks.length) && (
              <button className="load-more" onClick={showMore}>Mostrar mais</button>
            )}
          </>
        ) : libraryTab === 'playlists' && !selectedPlaylist ? (
          <>
            <div className="section-heading">
              <span>Playlists</span>
              <div className="section-heading__actions">
                <button className="text-action" onClick={() => run(makePlaylist())}><Plus />Nova</button>
              </div>
            </div>
            {playlists.length ? (
              <div className="group-list">
                {playlists.map(playlist => (
                  <button className="group-item" key={playlist.id} onClick={() => selectPlaylist(playlist.id)}>
                    <div className="playlist-icon"><ListMusic /></div>
                    <span className="group-item__text">
                      <strong>{playlist.name}</strong>
                      <small>{playlist.trackIds.length} músicas{playlist.source === 'rekordbox' ? ' · Importada' : ''}</small>
                    </span>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            ) : <div className="empty-library">Crie uma playlist para organizar suas músicas.</div>}
          </>
        ) : shouldShowTracks ? (
          <>
            {selectedPlaylist && (
              <div className="collection-actions">
                {libraryTracks.length > 0 && <button className="play-all" onClick={() => onPlayTrack(libraryTracks[0], libraryTracks)}><Play />Tocar tudo</button>}
                {selectedPlaylist.source === 'manual' ? (
                  <>
                    <button className="text-action" onClick={() => run(editPlaylist(selectedPlaylist))}>Renomear</button>
                    <button className="text-action text-action--danger" onClick={() => run(removePlaylist(selectedPlaylist))}>Excluir</button>
                  </>
                ) : (
                  <span className="playlist-source-note">Importada · somente leitura</span>
                )}
              </div>
            )}
            <div className="section-heading"><span>Músicas</span><small>{libraryTracks.length}</small></div>
            {pagedTracks.length ? (
              <TrackRows
                tracks={pagedTracks}
                context={libraryTracks}
                current={current}
                playing={playing}
                sort={sort}
                onSort={changeSort}
                onPlayTrack={onPlayTrack}
                onRemove={selectedPlaylist?.source === 'manual' ? trackId => run(setPlaylistTracks(selectedPlaylist.id, selectedPlaylist.trackIds.filter(id => id !== trackId))) : undefined}
                {...offlineTrackProps}
              />
            ) : <div className="empty-library">Nenhuma música encontrada.</div>}
            {visibleCount < libraryTracks.length && (
              <button className="load-more" onClick={showMore}>Mostrar mais {Math.min(LIBRARY_PAGE_SIZE, libraryTracks.length - visibleCount)} músicas</button>
            )}
          </>
        ) : null}
      </section>

      <div className="library-status">Última indexação: {scannedAt ? new Date(scannedAt).toLocaleString('pt-BR') : 'ainda não realizada'}</div>

      {current && (
        <MiniPlayer
          current={current}
          playing={playing}
          hasNext={hasNext}
          currentTime={currentTime}
          duration={duration}
          onOpenPlayer={onOpenPlayer}
          onTogglePlay={onTogglePlay}
          onNext={onNext}
        />
      )}
    </>
  );
}
