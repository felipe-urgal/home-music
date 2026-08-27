import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  Heart,
  ListMusic,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2
} from 'lucide-react';
import type { AuthenticatedUser, Playlist, Track } from '@home-music/shared';
import { canUseAdminLibraryActions } from '../frontend-access';
import type { CoverFilter, FavoriteFilter, TrackSort } from '../library-utils';
import type { LibraryData } from '../useLibraryData';
import { useDesktopLayout } from '../useDesktopLayout';
import { LIBRARY_PAGE_SIZE, type LibraryNavigation, type LibraryTab } from '../useLibraryNavigation';
import { Artwork } from './Artwork';
import { DesktopTrackTable } from './DesktopTrackTable';
import { MiniPlayer } from './MiniPlayer';

type LibraryScreenProps = {
  currentUser: AuthenticatedUser;
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
  { id: 'favorites', label: 'Favoritos', icon: Heart },
  { id: 'playlists', label: 'Playlists', icon: ListMusic }
];

function TrackRows({
  tracks,
  context,
  current,
  playing,
  favorites,
  sort,
  onSort,
  onPlayTrack,
  onToggleFavorite,
  onRemove
}: {
  tracks: Track[];
  context: Track[];
  current?: Track;
  playing: boolean;
  favorites: Set<string>;
  sort: TrackSort;
  onSort: (sort: TrackSort) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onToggleFavorite: (trackId: string) => void;
  onRemove?: (trackId: string) => void;
}) {
  const isDesktop = useDesktopLayout();

  if (isDesktop) {
    return (
      <DesktopTrackTable
        tracks={tracks}
        context={context}
        current={current}
        playing={playing}
        favorites={favorites}
        sort={sort}
        onSort={onSort}
        onPlayTrack={onPlayTrack}
        onToggleFavorite={onToggleFavorite}
        onRemove={onRemove}
      />
    );
  }

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
  currentUser,
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
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const canManageSharedLibrary = canUseAdminLibraryActions(currentUser);
  const {
    tracks,
    favoriteSet,
    playlists,
    scanning,
    scannedAt,
    toggleFavorite,
    rescan,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    setPlaylistTracks
  } = data;
  const {
    libraryTab,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    query,
    sort,
    formatFilter,
    favoriteFilter,
    coverFilter,
    availableFormats,
    activeViewOptionCount,
    canSortTracks,
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
    changeQuery,
    changeSort,
    changeFormatFilter,
    changeFavoriteFilter,
    changeCoverFilter,
    resetViewOptions,
    showMore
  } = navigation;

  const isDetail = Boolean(selectedPlaylist || folderPath);
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);

  function changeTab(tab: LibraryTab) {
    setViewControlsOpen(false);
    selectTab(tab);
  }

  function goBack() {
    setViewControlsOpen(false);
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

  const showSearch = !(libraryTab === 'playlists' && !selectedPlaylist);

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
        {canManageSharedLibrary && (
          <button className={`icon-button ${scanning ? 'is-loading' : ''}`} aria-label="Atualizar biblioteca" disabled={scanning} onClick={() => void scanNow()}><RefreshCw /></button>
        )}
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
        <>
          <div className="library-tools">
            <div className="search-box search-box--library">
              <Search />
              <input value={query} onChange={event => changeQuery(event.target.value)} placeholder="Música, artista, álbum ou pasta" />
            </div>
            <button
              className={`library-filter-toggle ${activeViewOptionCount > 0 ? 'is-active' : ''}`}
              type="button"
              aria-label="Ordenar e filtrar biblioteca"
              aria-expanded={viewControlsOpen}
              onClick={() => setViewControlsOpen(open => !open)}
            >
              <SlidersHorizontal />
              {activeViewOptionCount > 0 && <span>{activeViewOptionCount}</span>}
            </button>
          </div>

          {viewControlsOpen && (
            <div className="library-view-controls">
              {canSortTracks && (
                <label>
                  <span>Ordenar</span>
                  <select value={sort} onChange={event => changeSort(event.target.value as TrackSort)}>
                    <option value="current">Ordem atual</option>
                    <option value="title-asc">Título A–Z</option>
                    <option value="title-desc">Título Z–A</option>
                    <option value="artist-asc">Artista A–Z</option>
                    <option value="artist-desc">Artista Z–A</option>
                    <option value="album-asc">Álbum A–Z</option>
                    <option value="album-desc">Álbum Z–A</option>
                  </select>
                </label>
              )}

              <label>
                <span>Formato</span>
                <select value={formatFilter} onChange={event => changeFormatFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {availableFormats.map(format => <option key={format} value={format}>{format}</option>)}
                </select>
              </label>

              {libraryTab !== 'favorites' && (
                <label>
                  <span>Favoritos</span>
                  <select value={favoriteFilter} onChange={event => changeFavoriteFilter(event.target.value as FavoriteFilter)}>
                    <option value="all">Todos</option>
                    <option value="favorites">Somente favoritos</option>
                    <option value="not-favorites">Não favoritos</option>
                  </select>
                </label>
              )}

              <label>
                <span>Capa</span>
                <select value={coverFilter} onChange={event => changeCoverFilter(event.target.value as CoverFilter)}>
                  <option value="all">Todas</option>
                  <option value="with-cover">Com capa</option>
                  <option value="without-cover">Sem capa</option>
                </select>
              </label>

              {activeViewOptionCount > 0 && (
                <button className="library-view-controls__reset" type="button" onClick={resetViewOptions}>Limpar filtros</button>
              )}
            </div>
          )}
        </>
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
            {folderContextTracks.length > 0 && folderPath && (
              <button className="play-all" onClick={() => onPlayTrack(folderContextTracks[0], folderContextTracks)}><Play />Tocar tudo <span>{folderContextTracks.length}</span></button>
            )}

            {pagedFolders.length > 0 && (
              <>
                <div className="section-heading"><span>Pastas</span><small>{visibleFolders.length}</small></div>
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
                <div className="section-heading"><span>{query ? 'Resultados' : 'Músicas nesta pasta'}</span><small>{libraryTracks.length}</small></div>
                <TrackRows
                  tracks={pagedTracks}
                  context={folderContextTracks}
                  current={current}
                  playing={playing}
                  favorites={favoriteSet}
                  sort={sort}
                  onSort={changeSort}
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
            <div className="section-heading"><span>{libraryTab === 'favorites' ? 'Favoritos' : 'Músicas'}</span><small>{libraryTracks.length}</small></div>
            {pagedTracks.length ? (
              <TrackRows
                tracks={pagedTracks}
                context={libraryTracks}
                current={current}
                playing={playing}
                favorites={favoriteSet}
                sort={sort}
                onSort={changeSort}
                onPlayTrack={onPlayTrack}
                onToggleFavorite={trackId => run(toggleFavorite(trackId))}
                onRemove={selectedPlaylist?.source === 'manual' ? trackId => run(setPlaylistTracks(selectedPlaylist.id, selectedPlaylist.trackIds.filter(id => id !== trackId))) : undefined}
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
          onOpenPlayer={onOpenPlayer}
          onTogglePlay={onTogglePlay}
          onNext={onNext}
        />
      )}
    </>
  );
}
