import { useMemo, useState } from 'react';
import { ChevronRight, Folder, MoreHorizontal, Play, Plus, Sparkles } from 'lucide-react';
import type { Playlist, Track } from '@home-music/shared';
import { LIBRARY_PAGE_SIZE, type LibraryNavigation } from '../useLibraryNavigation';
import { useDesktopLayout } from '../useDesktopLayout';
import { Artwork } from './Artwork';
import { LibraryTrackRows, type LibraryTrackOfflineProps } from './LibraryTrackRows';

type LibraryContentProps = {
  navigation: LibraryNavigation;
  playlists: Playlist[];
  tracks: Track[];
  current?: Track;
  playing: boolean;
  offlineTrackProps: LibraryTrackOfflineProps;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onTogglePlay: () => void;
  onCreatePlaylist: () => Promise<void>;
  onEditPlaylist: (playlist: Playlist) => Promise<void>;
  onRemovePlaylist: (playlist: Playlist) => Promise<void>;
  onCreateSmartPlaylist: () => void;
  onEditSmartPlaylist: (playlist: Playlist) => void;
  onSetPlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<unknown>;
};

type PlaylistOrder = 'recent' | 'name';

function formatPlaylistDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
}

export function LibraryContent({
  navigation,
  playlists,
  tracks,
  current,
  playing,
  offlineTrackProps,
  onPlayTrack,
  onTogglePlay,
  onCreatePlaylist,
  onEditPlaylist,
  onRemovePlaylist,
  onCreateSmartPlaylist,
  onEditSmartPlaylist,
  onSetPlaylistTracks
}: LibraryContentProps) {
  const {
    libraryTab,
    selectedPlaylist,
    folderPath,
    folderContextTracks,
    query,
    sort,
    visibleCount,
    visibleFolders,
    libraryTracks,
    shouldShowTracks,
    pagedTracks,
    pagedFolders,
    enterFolder,
    selectPlaylist,
    changeSort,
    showMore
  } = navigation;
  const desktopLayout = useDesktopLayout();
  const [playlistOrder, setPlaylistOrder] = useState<PlaylistOrder>('recent');
  const folderSort = sort === 'title-desc' ? 'title-desc' : 'title-asc';
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);
  const tracksById = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const orderedPlaylists = useMemo(() => {
    const result = [...playlists];
    result.sort((left, right) => {
      if (playlistOrder === 'name') return left.name.localeCompare(right.name, 'pt-BR');
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
    return result;
  }, [playlistOrder, playlists]);

  function renderPlaylistCards() {
    return orderedPlaylists.map(playlist => {
      const contextTracks = playlist.trackIds
        .map(trackId => tracksById.get(trackId))
        .filter((track): track is Track => Boolean(track));
      const coverTrack = contextTracks.find(track => track.hasCover) ?? contextTracks[0];
      const playlistArtworkTracks = [
        ...contextTracks.filter(track => track.hasCover),
        ...contextTracks.filter(track => !track.hasCover)
      ].slice(0, 4);
      const updatedAt = formatPlaylistDate(playlist.updatedAt);

      return (
        <div className="group-item playlist-visual-card library-collection-card" key={playlist.id}>
          <button className="group-item__main playlist-visual-card__main" type="button" onClick={() => selectPlaylist(playlist.id)}>
            {desktopLayout && playlistArtworkTracks.length ? (
              <span
                className={`folder-visual-card__artwork-mosaic playlist-visual-card__artwork-mosaic is-count-${playlistArtworkTracks.length}`}
                aria-hidden="true"
              >
                {playlistArtworkTracks.map(track => <Artwork key={track.id} track={track} />)}
              </span>
            ) : (
              <Artwork track={coverTrack} />
            )}
            <span className="group-item__text">
              <strong>{playlist.name}</strong>
              <small>
                Playlist · {playlist.trackIds.length} músicas
                {updatedAt && <span className="group-item__updated"> · Atualizada em {updatedAt}</span>}
              </small>
            </span>
          </button>
          <button
            className="group-item__play"
            type="button"
            aria-label={`Tocar ${playlist.name}`}
            disabled={!contextTracks.length}
            onClick={() => {
              if (contextTracks[0]) onPlayTrack(contextTracks[0], contextTracks);
            }}
          >
            <Play aria-hidden="true" />
          </button>
          <MoreHorizontal className="group-item__more" aria-hidden="true" />
          <ChevronRight className="group-item__chevron" aria-hidden="true" />
        </div>
      );
    });
  }

  function renderPlaylistGrid() {
    if (!orderedPlaylists.length) {
      return <div className="empty-library">Crie uma playlist para organizar suas músicas.</div>;
    }

    return <div className="group-list playlist-visual-grid">{renderPlaylistCards()}</div>;
  }

  return (
    <section className="library-content">
      {libraryTab === 'folders' ? (
        <>
          {folderContextTracks.length > 0 && folderPath && !desktopLayout && (
            <button className="play-all" onClick={() => onPlayTrack(folderContextTracks[0], folderContextTracks)}><Play />Tocar tudo <span>{folderContextTracks.length}</span></button>
          )}

          {(pagedFolders.length > 0 || (desktopLayout && !folderPath && !query)) && (
            <>
              <div className={`section-heading ${!folderPath ? 'section-heading--folders-root' : ''}`}>
                {desktopLayout && !folderPath && !query ? (
                  <button className="text-action playlist-create-action library-root-create-playlist" type="button" onClick={() => run(onCreatePlaylist())}>
                    <Plus aria-hidden="true" />Nova playlist
                  </button>
                ) : (
                  <>
                    <span>
                      {folderPath ? 'Subpastas' : (
                        <span className="folder-heading__mobile">Suas pastas</span>
                      )}
                    </span>
                    {!folderPath && (
                      <label className="folder-order-control">
                        <span>Ordenar</span>
                        <select
                          aria-label="Ordenar pastas da biblioteca"
                          value={folderSort}
                          onChange={event => changeSort(event.target.value === 'title-desc' ? 'title-desc' : 'title-asc')}
                        >
                          <option value="title-asc">A–Z</option>
                          <option value="title-desc">Z–A</option>
                        </select>
                      </label>
                    )}
                    <small>{visibleFolders.length}</small>
                  </>
                )}
              </div>
              <div className={`folder-visual-grid ${desktopLayout && !folderPath && !query ? 'library-collection-grid' : ''}`}>
                {pagedFolders.map(folder => (
                  <button
                    className="folder-visual-card library-collection-card"
                    key={folder.path}
                    type="button"
                    aria-label={`Abrir ${folder.name}, ${folder.matchingTrackCount} músicas`}
                    onClick={() => enterFolder(folder.path)}
                  >
                    <span className="folder-visual-card__mobile-icon" aria-hidden="true"><Folder /></span>
                    {desktopLayout ? (
                      <span className={`folder-visual-card__artwork-mosaic is-count-${Math.max(1, Math.min(4, folder.artworks.length))}`} aria-hidden="true">
                        {(folder.artworks.length ? folder.artworks : [folder.artwork]).map((artworkTrack, index) => (
                          <Artwork key={artworkTrack?.id ?? `${folder.path}-artwork-${index}`} track={artworkTrack} />
                        ))}
                      </span>
                    ) : (
                      <Artwork track={folder.artwork} />
                    )}
                    <span className="folder-visual-card__text">
                      <strong>{folder.name}</strong>
                      <small>Pasta · {folder.matchingTrackCount} músicas</small>
                    </span>
                    <MoreHorizontal className="folder-visual-card__more" aria-hidden="true" />
                    <ChevronRight className="folder-visual-card__chevron" aria-hidden="true" />
                  </button>
                ))}
                {desktopLayout && !folderPath && !query && renderPlaylistCards()}
              </div>
            </>
          )}

          {pagedTracks.length > 0 && (
            <>
              <div className="section-heading"><span>{query ? 'Resultados' : 'Músicas nesta pasta'}</span><small>{libraryTracks.length}</small></div>
              <LibraryTrackRows
                tracks={pagedTracks}
                context={folderContextTracks}
                current={current}
                playing={playing}
                sort={sort}
                onSort={changeSort}
                onPlayTrack={onPlayTrack}
                onTogglePlay={onTogglePlay}
                desktopVariant={folderPath || query ? 'grid' : 'table'}
                {...offlineTrackProps}
              />
            </>
          )}

          {!pagedFolders.length && !pagedTracks.length && (!desktopLayout || Boolean(folderPath) || Boolean(query)) && (
            <div className="empty-library">Nenhum item encontrado nesta pasta.</div>
          )}

          {visibleCount < Math.max(visibleFolders.length, libraryTracks.length) && (
            <button className="load-more" onClick={showMore}>Mostrar mais</button>
          )}
        </>
      ) : libraryTab === 'playlists' && !selectedPlaylist ? (
        <>
          <div className="section-heading section-heading--playlists-root">
            <span>Playlists</span>
            <div className="section-heading__actions">
              <button className="text-action playlist-create-action" onClick={() => run(onCreatePlaylist())}><Plus />Nova playlist</button>
              <button className="text-action playlist-smart-action" onClick={onCreateSmartPlaylist}><Sparkles />Inteligente</button>
              <label className="playlist-order-control">
                <span>Ordenar:</span>
                <select value={playlistOrder} onChange={event => setPlaylistOrder(event.target.value as PlaylistOrder)}>
                  <option value="recent">Recentes</option>
                  <option value="name">A–Z</option>
                </select>
              </label>
            </div>
          </div>
          {renderPlaylistGrid()}
        </>
      ) : shouldShowTracks ? (
        <>
          {selectedPlaylist && !desktopLayout && (
            <div className="collection-actions">
              {libraryTracks.length > 0 && <button className="play-all" onClick={() => onPlayTrack(libraryTracks[0], libraryTracks)}><Play />Tocar tudo</button>}
              {selectedPlaylist.source === 'manual' ? (
                <>
                  <button className="text-action" onClick={() => run(onEditPlaylist(selectedPlaylist))}>Renomear</button>
                  <button className="text-action text-action--danger" onClick={() => run(onRemovePlaylist(selectedPlaylist))}>Excluir</button>
                </>
              ) : selectedPlaylist.source === 'smart' ? (
                <>
                  <button className="text-action" onClick={() => onEditSmartPlaylist(selectedPlaylist)}><Sparkles />Editar regra</button>
                  <button className="text-action text-action--danger" onClick={() => run(onRemovePlaylist(selectedPlaylist))}>Excluir</button>
                </>
              ) : (
                <span className="playlist-source-note">Importada · somente leitura</span>
              )}
            </div>
          )}
          <div className="section-heading"><span>Músicas</span><small>{libraryTracks.length}</small></div>
          {pagedTracks.length ? (
            <LibraryTrackRows
              tracks={pagedTracks}
              context={libraryTracks}
              current={current}
              playing={playing}
              sort={sort}
              onSort={changeSort}
              onPlayTrack={onPlayTrack}
              onTogglePlay={onTogglePlay}
              onRemove={selectedPlaylist?.source === 'manual' ? trackId => run(onSetPlaylistTracks(selectedPlaylist.id, selectedPlaylist.trackIds.filter(id => id !== trackId))) : undefined}
              desktopVariant={selectedPlaylist ? 'grid' : 'table'}
              {...offlineTrackProps}
            />
          ) : <div className="empty-library">Nenhuma música encontrada.</div>}
          {visibleCount < libraryTracks.length && (
            <button className="load-more" onClick={showMore}>Mostrar mais {Math.min(LIBRARY_PAGE_SIZE, libraryTracks.length - visibleCount)} músicas</button>
          )}
        </>
      ) : null}
    </section>
  );
}
