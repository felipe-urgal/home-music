import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Folder,
  Heart,
  History,
  ListMusic,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users
} from 'lucide-react';
import type { Playlist, Track } from '@home-music/shared';
import { uniqueTracksById } from '../player-state';
import type { LibraryData } from '../useLibraryData';
import { LIBRARY_PAGE_SIZE, type LibraryNavigation, type LibraryTab } from '../useLibraryNavigation';
import { Artwork } from './Artwork';
import { MiniPlayer } from './MiniPlayer';

type LibraryScreenProps = {
  data: LibraryData;
  current?: Track;
  playing: boolean;
  hasNext: boolean;
  navigation: LibraryNavigation;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
};

const tabs: Array<{ id: LibraryTab; label: string; icon: typeof Folder }> = [
  { id: 'folders', label: 'Pastas', icon: Folder },
  { id: 'artists', label: 'Artistas', icon: Users },
  { id: 'albums', label: 'Álbuns', icon: Disc3 },
  { id: 'tracks', label: 'Músicas', icon: Music2 },
  { id: 'favorites', label: 'Favoritos', icon: Heart },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'history', label: 'Histórico', icon: History }
];

function TrackRows({
  tracks,
  context,
  current,
  playing,
  favorites,
  onPlayTrack,
  onToggleFavorite,
  onRemove
}: {
  tracks: Track[];
  context: Track[];
  current?: Track;
  playing: boolean;
  favorites: Set<string>;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onToggleFavorite: (trackId: string) => void;
  onRemove?: (trackId: string) => void;
}) {
  return (
    <div className="library-track-list">
      {tracks.map(track => {
        const favorite = favorites.has(track.id);
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
            <button
              className={`track-action ${favorite ? 'is-active' : ''}`}
              aria-label={favorite ? 'Remover dos favoritos' : 'Favoritar'}
              onClick={() => onToggleFavorite(track.id)}
            >
              <Heart fill={favorite ? 'currentColor' : 'none'} />
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
  data,
  current,
  playing,
  hasNext,
  navigation,
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onPlayTrack
}: LibraryScreenProps) {
  const {
    tracks,
    favoriteSet,
    history,
    playlists,
    scanning,
    scannedAt,
    refreshHistory,
    toggleFavorite,
    rescan,
    clearHistory,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    setPlaylistTracks
  } = data;
  const {
    libraryTab,
    selectedGroup,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    query,
    visibleCount,
    visibleGroups,
    visibleFolders,
    libraryTracks,
    shouldShowTracks,
    pagedTracks,
    pagedGroups,
    pagedFolders,
    selectTab,
    selectGroup,
    leaveGroup,
    enterFolder,
    leaveFolder,
    selectPlaylist,
    leavePlaylist,
    changeQuery,
    showMore
  } = navigation;

  const isDetail = Boolean(selectedGroup || selectedPlaylist || folderPath);
  const historyTracks = uniqueTracksById(history.map(item => item.track));
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);

  function changeTab(tab: LibraryTab) {
    selectTab(tab);
    if (tab === 'history') run(refreshHistory());
  }

  function goBack() {
    if (selectedGroup) leaveGroup();
    else if (selectedPlaylist) leavePlaylist();
    else if (folderPath) leaveFolder();
  }

  function title() {
    if (selectedGroup) return selectedGroup.name;
    if (selectedPlaylist) return selectedPlaylist.name;
    if (libraryTab === 'folders' && folderPath) return folderView.name;
    return 'Biblioteca';
  }

  function subtitle() {
    if (selectedGroup || selectedPlaylist) return `${libraryTracks.length} músicas`;
    if (libraryTab === 'folders' && folderPath) return `${folderView.allTracks.length} músicas`;
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

  const showSearch = libraryTab !== 'history' && !(libraryTab === 'playlists' && !selectedPlaylist);

  return (
    <>
      <header className="library-header">
        {isDetail ? (
          <button className="icon-button" aria-label="Voltar" onClick={goBack}><ChevronLeft /></button>
        ) : (
          <span className="library-header__spacer" />
        )}
        <div className="library-header__title">
          <strong>{title()}</strong>
          <small>{subtitle()}</small>
        </div>
        <button className={`icon-button ${scanning ? 'is-loading' : ''}`} aria-label="Atualizar biblioteca" disabled={scanning} onClick={() => void scanNow()}><RefreshCw /></button>
        <button className="icon-button" aria-label="Voltar ao player" onClick={onOpenPlayer}><Music2 /></button>
      </header>

      {libraryTab === 'folders' && folderView.breadcrumbs.length > 0 && (
        <nav className="breadcrumbs" aria-label="Caminho da pasta">
          <button onClick={() => enterFolder('')}>Pastas</button>
          {folderView.breadcrumbs.map(crumb => (
            <span key={crumb.path}><ChevronRight /><button onClick={() => enterFolder(crumb.path)}>{crumb.name}</button></span>
          ))}
        </nav>
      )}

      {showSearch && (
        <div className="search-box search-box--library">
          <Search />
          <input value={query} onChange={event => changeQuery(event.target.value)} placeholder="Música, artista, álbum ou pasta" />
        </div>
      )}

      {!isDetail && (
        <nav className="library-tabs" aria-label="Navegação da biblioteca">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={libraryTab === tab.id ? 'is-active' : ''} onClick={() => changeTab(tab.id)}>
                <Icon />{tab.label}
              </button>
            );
          })}
        </nav>
      )}

      <section className="library-content">
        {libraryTab === 'folders' ? (
          <>
            {folderView.allTracks.length > 0 && folderPath && (
              <button className="play-all" onClick={() => onPlayTrack(folderView.allTracks[0], folderView.allTracks)}><Play />Tocar tudo <span>{folderView.allTracks.length}</span></button>
            )}

            {pagedFolders.length > 0 && (
              <>
                <div className="section-heading"><span>Pastas</span><small>{visibleFolders.length}</small></div>
                <div className="group-list">
                  {pagedFolders.map(folder => (
                    <button className="group-item" key={folder.path} onClick={() => enterFolder(folder.path)}>
                      <Artwork track={folder.artwork} />
                      <span className="group-item__text"><strong>{folder.name}</strong><small>{folder.tracks.length} músicas</small></span>
                      <ChevronRight />
                    </button>
                  ))}
                </div>
              </>
            )}

            {pagedTracks.length > 0 && (
              <>
                <div className="section-heading"><span>{query ? 'Resultados' : 'Músicas nesta pasta'}</span><small>{libraryTracks.length}</small></div>
                <TrackRows
                  tracks={pagedTracks}
                  context={query ? folderContextTracks : folderView.allTracks}
                  current={current}
                  playing={playing}
                  favorites={favoriteSet}
                  onPlayTrack={onPlayTrack}
                  onToggleFavorite={trackId => run(toggleFavorite(trackId))}
                />
              </>
            )}

            {!pagedFolders.length && !pagedTracks.length && <div className="empty-library">Nenhum item encontrado nesta pasta.</div>}

            {visibleCount < Math.max(visibleFolders.length, libraryTracks.length) && (
              <button className="load-more" onClick={showMore}>Mostrar mais</button>
            )}
          </>
        ) : libraryTab === 'history' ? (
          <>
            <div className="section-heading">
              <span>Reproduzidas recentemente</span>
              {history.length > 0 && <button className="text-action" onClick={() => run(clearHistory())}>Limpar</button>}
            </div>
            {history.length ? (
              <div className="history-list">
                {history.map(item => (
                  <div className="history-row" key={item.id}>
                    <button className="library-track__main" onClick={() => onPlayTrack(item.track, historyTracks)}>
                      <Artwork track={item.track} />
                      <span className="library-track__text"><strong>{item.track.title}</strong><small>{item.track.artist} · {new Date(item.playedAt).toLocaleString('pt-BR')}</small></span>
                      <Play className="library-track__action" />
                    </button>
                  </div>
                ))}
              </div>
            ) : <div className="empty-library">Seu histórico aparecerá aqui quando você começar a ouvir músicas.</div>}
          </>
        ) : libraryTab === 'playlists' && !selectedPlaylist ? (
          <>
            <div className="section-heading"><span>Playlists</span><button className="text-action" onClick={() => run(makePlaylist())}><Plus />Nova</button></div>
            {playlists.length ? (
              <div className="group-list">
                {playlists.map(playlist => (
                  <button className="group-item" key={playlist.id} onClick={() => selectPlaylist(playlist.id)}>
                    <div className="playlist-icon"><ListMusic /></div>
                    <span className="group-item__text"><strong>{playlist.name}</strong><small>{playlist.trackIds.length} músicas</small></span>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            ) : <div className="empty-library">Crie sua primeira playlist para organizar músicas do seu jeito.</div>}
          </>
        ) : shouldShowTracks ? (
          <>
            {selectedPlaylist && (
              <div className="collection-actions">
                {libraryTracks.length > 0 && <button className="play-all" onClick={() => onPlayTrack(libraryTracks[0], libraryTracks)}><Play />Tocar tudo</button>}
                <button className="text-action" onClick={() => run(editPlaylist(selectedPlaylist))}>Renomear</button>
                <button className="text-action text-action--danger" onClick={() => run(removePlaylist(selectedPlaylist))}>Excluir</button>
              </div>
            )}
            <div className="section-heading"><span>{libraryTab === 'favorites' ? 'Favoritos' : 'Músicas'}</span><small>{libraryTracks.length}</small></div>
            {pagedTracks.length ? (
              <TrackRows
                tracks={pagedTracks}
                context={libraryTracks}
                current={current}
                playing={playing}
                favorites={favoriteSet}
                onPlayTrack={onPlayTrack}
                onToggleFavorite={trackId => run(toggleFavorite(trackId))}
                onRemove={selectedPlaylist ? trackId => run(setPlaylistTracks(selectedPlaylist.id, selectedPlaylist.trackIds.filter(id => id !== trackId))) : undefined}
              />
            ) : <div className="empty-library">Nenhuma música encontrada.</div>}
            {visibleCount < libraryTracks.length && (
              <button className="load-more" onClick={showMore}>Mostrar mais {Math.min(LIBRARY_PAGE_SIZE, libraryTracks.length - visibleCount)} músicas</button>
            )}
          </>
        ) : (
          <>
            <div className="section-heading"><span>{libraryTab === 'artists' ? 'Artistas' : 'Álbuns'}</span><small>{visibleGroups.length}</small></div>
            <div className="group-list">
              {pagedGroups.map(group => (
                <button className="group-item" key={group.key} onClick={() => selectGroup(group.key)}>
                  <Artwork track={group.artwork} />
                  <span className="group-item__text"><strong>{group.name}</strong><small>{group.subtitle ? `${group.subtitle} · ` : ''}{group.tracks.length} músicas</small></span>
                  <ChevronRight />
                </button>
              ))}
            </div>
            {visibleCount < visibleGroups.length && <button className="load-more" onClick={showMore}>Mostrar mais</button>}
          </>
        )}
      </section>

      <div className="library-status">Última indexação: {scannedAt ? new Date(scannedAt).toLocaleString('pt-BR') : 'ainda não realizada'}</div>

      {current && (
        <MiniPlayer
          current={current}
          playing={playing}
          hasNext={hasNext}
          onOpenPlayer={onOpenPlayer}
          onTogglePlay={onTogglePlay}
          onNext={onNext}
        />
      )}
    </>
  );
}
