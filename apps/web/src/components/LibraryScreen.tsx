import { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Folder,
  ListMusic,
  Music2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2
} from 'lucide-react';
import type { AuthenticatedUser, Playlist, Track } from '@home-music/shared';
import { canUseAdminLibraryActions } from '../frontend-access';
import type { CoverFilter, TrackSort } from '../library-utils';
import type { OfflineDownloads } from '../offline-downloads';
import type { LibraryData } from '../useLibraryData';
import { useDesktopLayout } from '../useDesktopLayout';
import { LIBRARY_PAGE_SIZE, type LibraryNavigation, type LibraryTab } from '../useLibraryNavigation';
import { useLibraryViews } from '../useLibraryViews';
import { Artwork } from './Artwork';
import { DesktopTrackTable } from './DesktopTrackTable';
import { MiniPlayer } from './MiniPlayer';
import { SmartPlaylistDialog } from './SmartPlaylistDialog';

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
  const [smartPlaylistEditor, setSmartPlaylistEditor] = useState<{ playlist: Playlist | null } | null>(null);
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const {
    tracks,
    playlists,
    scanning,
    scannedAt,
    refreshPlaylists,
    rescan,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    previewSmartPlaylist,
    createSmartPlaylist,
    updateSmartPlaylist,
    deleteSmartPlaylist,
    setPlaylistTracks,
    reportError
  } = data;
  const savedViews = useLibraryViews(reportError);
  const {
    libraryTab,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    query,
    sort,
    formatFilter,
    coverFilter,
    availableFormats,
    activeViewOptionCount,
    canSortTracks,
    currentViewDefinition,
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
    changeCoverFilter,
    applyLibraryView,
    resetViewOptions,
    showMore
  } = navigation;

  const isDetail = Boolean(selectedPlaylist || folderPath);
  const showViewTools = !(libraryTab === 'playlists' && !selectedPlaylist);
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);

  useEffect(() => {
    void refreshPlaylists().catch(reportError);
  }, [refreshPlaylists, reportError]);

  function goBack() {
    setViewControlsOpen(false);
    if (selectedPlaylist) leavePlaylist();
    else if (folderPath) leaveFolder();
  }

  function changeTab(tab: LibraryTab) {
    setViewControlsOpen(false);
    selectTab(tab);
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
    if (!window.confirm(`Excluir a playlist “${playlist.name}”?`)) return;

    if (playlist.source === 'smart') await deleteSmartPlaylist(playlist.id);
    else await deletePlaylist(playlist.id);
    leavePlaylist();
  }

  async function saveCurrentView() {
    const name = window.prompt('Nome da nova view inteligente:')?.trim();
    if (!name) return;
    await savedViews.createView(name, currentViewDefinition);
  }

  async function renameSavedView(id: string, currentName: string) {
    const name = window.prompt('Novo nome da view:', currentName)?.trim();
    if (name && name !== currentName) await savedViews.renameView(id, name);
  }

  async function removeSavedView(id: string, name: string) {
    if (!window.confirm(`Excluir a view “${name}”?`)) return;
    await savedViews.deleteView(id);
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
              <button key={tab.id} className={libraryTab === tab.id ? 'is-active' : ''} onClick={() => changeTab(tab.id)}>
                <Icon />{tab.label}
              </button>
            );
          })}
        </nav>
      )}

      {showViewTools && (
        <section className="library-smart-view-tools" aria-label="Busca, filtros e views inteligentes">
          <div className="library-tools">
            <label className="search-box search-box--library">
              <Search aria-hidden="true" />
              <span className="sr-only">Buscar na biblioteca</span>
              <input
                value={query}
                onChange={event => changeQuery(event.target.value)}
                placeholder="Música, artista, álbum ou pasta"
              />
            </label>
            <button
              className={`library-filter-toggle ${activeViewOptionCount > 0 ? 'is-active' : ''}`}
              type="button"
              aria-label="Ordenar, filtrar e gerenciar views"
              aria-expanded={viewControlsOpen}
              onClick={() => setViewControlsOpen(open => !open)}
            >
              <SlidersHorizontal aria-hidden="true" />
              {activeViewOptionCount > 0 && <span>{activeViewOptionCount}</span>}
            </button>
          </div>

          {savedViews.views.length > 0 && (
            <div className="library-saved-view-strip" aria-label="Views salvas">
              {savedViews.views.map(view => (
                <button key={view.id} type="button" onClick={() => applyLibraryView(view.definition)}>
                  <Sparkles aria-hidden="true" />
                  <span>{view.name}</span>
                </button>
              ))}
            </div>
          )}

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

              <label>
                <span>Capa</span>
                <select value={coverFilter} onChange={event => changeCoverFilter(event.target.value as CoverFilter)}>
                  <option value="all">Todas</option>
                  <option value="with-cover">Com capa</option>
                  <option value="without-cover">Sem capa</option>
                </select>
              </label>

              <div className="library-view-controls__actions">
                <button type="button" onClick={() => run(saveCurrentView())}><BookmarkPlus />Salvar view</button>
                {(query || activeViewOptionCount > 0) && (
                  <button type="button" onClick={() => { changeQuery(''); resetViewOptions(); }}>Limpar</button>
                )}
              </div>

              {savedViews.loading ? (
                <div className="library-saved-view-status">Carregando views…</div>
              ) : savedViews.views.length > 0 ? (
                <div className="library-saved-view-manager">
                  <span className="library-saved-view-manager__title">Views salvas</span>
                  {savedViews.views.map(view => (
                    <div className="library-saved-view-row" key={view.id}>
                      <button className="library-saved-view-row__open" type="button" onClick={() => applyLibraryView(view.definition)}>
                        <Sparkles aria-hidden="true" />
                        <span>{view.name}</span>
                      </button>
                      <button type="button" aria-label={`Renomear view ${view.name}`} onClick={() => run(renameSavedView(view.id, view.name))}><Pencil /></button>
                      <button className="is-danger" type="button" aria-label={`Excluir view ${view.name}`} onClick={() => run(removeSavedView(view.id, view.name))}><Trash2 /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="library-saved-view-status">Salve a busca e os filtros atuais para reutilizar depois.</div>
              )}
            </div>
          )}
        </section>
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
                <div className="section-heading"><span>{query ? 'Resultados' : 'Músicas nesta pasta'}</span><small>{libraryTracks.length}</small></div>
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
                <button className="text-action" onClick={() => setSmartPlaylistEditor({ playlist: null })}><Sparkles />Inteligente</button>
              </div>
            </div>
            {playlists.length ? (
              <div className="group-list">
                {playlists.map(playlist => (
                  <button className="group-item" key={playlist.id} onClick={() => selectPlaylist(playlist.id)}>
                    <div className="playlist-icon">{playlist.source === 'smart' ? <Sparkles /> : <ListMusic />}</div>
                    <span className="group-item__text">
                      <strong>{playlist.name}</strong>
                      <small>
                        {playlist.trackIds.length} músicas
                        {playlist.source === 'rekordbox' ? ' · Importada' : playlist.source === 'smart' ? ' · Inteligente' : ''}
                      </small>
                    </span>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            ) : <div className="empty-library">Crie uma playlist manual ou inteligente para organizar suas músicas.</div>}
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
                ) : selectedPlaylist.source === 'smart' ? (
                  <>
                    <button className="text-action" onClick={() => setSmartPlaylistEditor({ playlist: selectedPlaylist })}><Sparkles />Editar regra</button>
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

      <SmartPlaylistDialog
        open={Boolean(smartPlaylistEditor)}
        playlist={smartPlaylistEditor?.playlist}
        tracks={tracks}
        onPreview={previewSmartPlaylist}
        onSave={async (name, rule) => {
          const existing = smartPlaylistEditor?.playlist;
          if (existing) await updateSmartPlaylist(existing.id, { name, rule });
          else await createSmartPlaylist(name, rule);
        }}
        onClose={() => setSmartPlaylistEditor(null)}
      />
    </>
  );
}
