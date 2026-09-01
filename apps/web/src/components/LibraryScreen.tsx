import { useEffect, useMemo, useState } from 'react';
import type { AuthenticatedUser, Playlist, Track } from '@home-music/shared';
import { canUseAdminLibraryActions } from '../frontend-access';
import type { OfflineCollectionDownloadInput, OfflineDownloads } from '../offline-downloads';
import type { LibraryData } from '../useLibraryData';
import type { LibraryNavigation, LibraryTab } from '../useLibraryNavigation';
import { useLibraryViews } from '../useLibraryViews';
import { LibraryContent } from './LibraryContent';
import { LibraryNavigationChrome } from './LibraryNavigationChrome';
import { LibraryViewTools } from './LibraryViewTools';
import { MiniPlayer } from './MiniPlayer';
import { OfflineCollectionControl, offlineCollectionTracksByIds } from './OfflineCollectionControl';
import { SmartPlaylistDialog } from './SmartPlaylistDialog';

type LibraryOfflineDownloads = Pick<OfflineDownloads,
  | 'supported'
  | 'downloadedIds'
  | 'downloadingIds'
  | 'download'
  | 'remove'
  | 'syncCollection'
  | 'pauseCollection'
  | 'removeCollection'
  | 'getCollectionState'
>;

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
    currentViewDefinition,
    libraryTracks,
    selectTab,
    leaveFolder,
    leavePlaylist
  } = navigation;

  const isDetail = Boolean(selectedPlaylist || folderPath);
  const showViewTools = !(libraryTab === 'playlists' && !selectedPlaylist);

  const offlineCollectionTarget = useMemo<OfflineCollectionDownloadInput | null>(() => {
    if (selectedPlaylist) {
      return {
        kind: 'playlist',
        sourceId: selectedPlaylist.id,
        name: selectedPlaylist.name,
        // Offline representa a coleção completa, nunca o filtro/busca atual.
        tracks: offlineCollectionTracksByIds(selectedPlaylist.trackIds, tracks)
      };
    }
    if (libraryTab === 'folders' && folderPath) {
      return {
        kind: 'folder',
        sourceId: folderPath,
        name: folderView.name,
        // allTracks é o snapshot completo da pasta e subpastas, sem o filtro da view.
        tracks: folderView.allTracks
      };
    }
    return null;
  }, [folderPath, folderView.allTracks, folderView.name, libraryTab, selectedPlaylist, tracks]);

  const offlineCollectionState = offlineCollectionTarget
    ? offline.getCollectionState({
        kind: offlineCollectionTarget.kind,
        sourceId: offlineCollectionTarget.sourceId,
        name: offlineCollectionTarget.name,
        trackIds: offlineCollectionTarget.tracks.map(track => track.id)
      })
    : null;

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
      <LibraryNavigationChrome
        navigation={navigation}
        isDetail={isDetail}
        title={title()}
        subtitle={subtitle()}
        canManageSharedLibrary={canManageSharedLibrary}
        scanning={scanning}
        onBack={goBack}
        onChangeTab={changeTab}
        onScan={() => void scanNow()}
        onOpenPlayer={onOpenPlayer}
      />

      {offline.supported && offlineCollectionTarget && offlineCollectionState && (
        <OfflineCollectionControl
          target={offlineCollectionTarget}
          state={offlineCollectionState}
          onSync={offline.syncCollection}
          onPause={() => offline.pauseCollection(offlineCollectionTarget.kind, offlineCollectionTarget.sourceId)}
          onRemove={() => offline.removeCollection(offlineCollectionTarget.kind, offlineCollectionTarget.sourceId)}
          onError={reportError}
        />
      )}

      {showViewTools && (
        <LibraryViewTools
          navigation={navigation}
          savedViews={savedViews}
          open={viewControlsOpen}
          onToggleOpen={() => setViewControlsOpen(open => !open)}
          onSaveCurrentView={saveCurrentView}
          onRenameSavedView={renameSavedView}
          onRemoveSavedView={removeSavedView}
          reportError={reportError}
        />
      )}

      <LibraryContent
        navigation={navigation}
        playlists={playlists}
        current={current}
        playing={playing}
        offlineTrackProps={offlineTrackProps}
        onPlayTrack={onPlayTrack}
        onCreatePlaylist={makePlaylist}
        onEditPlaylist={editPlaylist}
        onRemovePlaylist={removePlaylist}
        onCreateSmartPlaylist={() => setSmartPlaylistEditor({ playlist: null })}
        onEditSmartPlaylist={playlist => setSmartPlaylistEditor({ playlist })}
        onSetPlaylistTracks={setPlaylistTracks}
      />

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
