import { ChevronRight, ListMusic, Play, Plus, Sparkles } from 'lucide-react';
import type { Playlist, Track } from '@home-music/shared';
import { LIBRARY_PAGE_SIZE, type LibraryNavigation } from '../useLibraryNavigation';
import { Artwork } from './Artwork';
import { LibraryTrackRows, type LibraryTrackOfflineProps } from './LibraryTrackRows';

type LibraryContentProps = {
  navigation: LibraryNavigation;
  playlists: Playlist[];
  current?: Track;
  playing: boolean;
  offlineTrackProps: LibraryTrackOfflineProps;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onCreatePlaylist: () => Promise<void>;
  onEditPlaylist: (playlist: Playlist) => Promise<void>;
  onRemovePlaylist: (playlist: Playlist) => Promise<void>;
  onCreateSmartPlaylist: () => void;
  onEditSmartPlaylist: (playlist: Playlist) => void;
  onSetPlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<unknown>;
};

export function LibraryContent({
  navigation,
  playlists,
  current,
  playing,
  offlineTrackProps,
  onPlayTrack,
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
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);

  return (
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
              <LibraryTrackRows
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
              <button className="text-action" onClick={() => run(onCreatePlaylist())}><Plus />Nova</button>
              <button className="text-action" onClick={onCreateSmartPlaylist}><Sparkles />Inteligente</button>
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
              onRemove={selectedPlaylist?.source === 'manual' ? trackId => run(onSetPlaylistTracks(selectedPlaylist.id, selectedPlaylist.trackIds.filter(id => id !== trackId))) : undefined}
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
