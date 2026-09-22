import { useEffect, useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { AuthenticatedUser, Playlist, Track } from '@home-music/shared';
import { canUseAdminLibraryActions } from '../frontend-access';
import type { OfflineCollectionDownloadInput, OfflineDownloads } from '../offline-downloads';
import type { LibraryData } from '../useLibraryData';
import type { LibraryNavigation, LibraryTab } from '../useLibraryNavigation';
import { useDesktopLayout } from '../useDesktopLayout';
import { useLibraryViews } from '../useLibraryViews';
import { DesktopFolderSummary } from './DesktopFolderSummary';
import { DesktopPlaylistSummary } from './DesktopPlaylistSummary';
import { LibraryContent } from './LibraryContent';
import { LibraryNavigationChrome } from './LibraryNavigationChrome';
import { LibraryViewTools } from './LibraryViewTools';
import { MiniPlayer } from './MiniPlayer';
import { MobileSheet } from './MobileSheet';
import { OfflineCollectionControl, offlineCollectionTracksByIds } from './OfflineCollectionControl';
import { SmartPlaylistDialog } from './SmartPlaylistDialog';
import { Artwork } from './Artwork';

type LibraryOfflineDownloads = Pick<OfflineDownloads,
  | 'supported'
  | 'downloadedIds'
  | 'individualDownloadedIds'
  | 'collectionDownloadedIds'
  | 'downloadingIds'
  | 'download'
  | 'remove'
  | 'syncCollection'
  | 'pauseCollection'
  | 'removeCollection'
  | 'getCollectionState'
>;

type MobileTextEditor =
  | { kind: 'create-playlist'; value: string }
  | { kind: 'rename-playlist'; playlist: Playlist; value: string }
  | { kind: 'save-view'; value: string }
  | { kind: 'rename-view'; id: string; currentName: string; value: string };

type MobileConfirm =
  | { kind: 'delete-playlist'; playlist: Playlist }
  | { kind: 'delete-view'; id: string; name: string }
  | { kind: 'remove-download'; track: Track; message: string };

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
  const desktopLayout = useDesktopLayout();
  const [smartPlaylistEditor, setSmartPlaylistEditor] = useState<{ playlist: Playlist | null } | null>(null);
  const [viewControlsOpen, setViewControlsOpen] = useState(false);
  const [mobileCollectionMenuOpen, setMobileCollectionMenuOpen] = useState(false);
  const [mobileTextEditor, setMobileTextEditor] = useState<MobileTextEditor | null>(null);
  const [mobileConfirm, setMobileConfirm] = useState<MobileConfirm | null>(null);
  const [mobileNotice, setMobileNotice] = useState<string | null>(null);
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
    addTrackToPlaylist,
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
  const editablePlaylists = playlists.filter(playlist => playlist.source === 'manual');

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

  useEffect(() => {
    if (!mobileNotice) return;
    const timeout = window.setTimeout(() => setMobileNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [mobileNotice]);

  function goBack() {
    setViewControlsOpen(false);
    setMobileCollectionMenuOpen(false);
    if (selectedPlaylist) {
      leavePlaylist();
    } else if (folderPath) leaveFolder();
  }

  function changeTab(tab: LibraryTab) {
    setViewControlsOpen(false);
    setMobileCollectionMenuOpen(false);
    selectTab(tab);
  }

  function title() {
    if (selectedPlaylist) return selectedPlaylist.name;
    if (libraryTab === 'folders' && folderPath) return folderView.name;
    if (libraryTab === 'folders') return 'Suas Pastas';
    return 'Suas Playlists';
  }

  function subtitle() {
    if (selectedPlaylist) return `${libraryTracks.length} músicas`;
    if (libraryTab === 'folders' && folderPath) return `${folderContextTracks.length} músicas`;
    if (libraryTab === 'folders') return 'Organize sua música do seu jeito.';
    return 'Trilhas para todos os momentos.';
  }

  async function makePlaylist() {
    if (!desktopLayout) {
      setMobileTextEditor({ kind: 'create-playlist', value: '' });
      return;
    }
    const name = window.prompt('Nome da nova playlist:')?.trim();
    if (name) await createPlaylist(name);
  }

  async function editPlaylist(playlist: Playlist) {
    if (!desktopLayout) {
      setMobileTextEditor({ kind: 'rename-playlist', playlist, value: playlist.name });
      return;
    }
    const name = window.prompt('Novo nome da playlist:', playlist.name)?.trim();
    if (name && name !== playlist.name) await renamePlaylist(playlist.id, name);
  }

  async function deletePlaylistNow(playlist: Playlist) {
    if (playlist.source === 'smart') await deleteSmartPlaylist(playlist.id);
    else await deletePlaylist(playlist.id);
    if (desktopLayout) selectTab('folders');
    else leavePlaylist();
  }

  async function removePlaylist(playlist: Playlist) {
    if (!desktopLayout) {
      setMobileConfirm({ kind: 'delete-playlist', playlist });
      return;
    }
    if (!window.confirm(`Excluir a playlist “${playlist.name}”?`)) return;
    await deletePlaylistNow(playlist);
  }

  async function saveCurrentView() {
    if (!desktopLayout) {
      setViewControlsOpen(false);
      setMobileTextEditor({ kind: 'save-view', value: '' });
      return;
    }
    const name = window.prompt('Nome da nova view inteligente:')?.trim();
    if (!name) return;
    await savedViews.createView(name, currentViewDefinition);
  }

  async function renameSavedView(id: string, currentName: string) {
    if (!desktopLayout) {
      setViewControlsOpen(false);
      setMobileTextEditor({ kind: 'rename-view', id, currentName, value: currentName });
      return;
    }
    const name = window.prompt('Novo nome da view:', currentName)?.trim();
    if (name && name !== currentName) await savedViews.renameView(id, name);
  }

  async function removeSavedView(id: string, name: string) {
    if (!desktopLayout) {
      setViewControlsOpen(false);
      setMobileConfirm({ kind: 'delete-view', id, name });
      return;
    }
    if (!window.confirm(`Excluir a view “${name}”?`)) return;
    await savedViews.deleteView(id);
  }

  async function submitMobileTextEditor() {
    const editor = mobileTextEditor;
    const name = editor?.value.trim() ?? '';
    if (!editor || !name) return;

    if (editor.kind === 'create-playlist') await createPlaylist(name);
    else if (editor.kind === 'rename-playlist' && name !== editor.playlist.name) {
      await renamePlaylist(editor.playlist.id, name);
    } else if (editor.kind === 'save-view') {
      await savedViews.createView(name, currentViewDefinition);
    } else if (editor.kind === 'rename-view' && name !== editor.currentName) {
      await savedViews.renameView(editor.id, name);
    }

    setMobileTextEditor(null);
  }

  async function confirmMobileAction() {
    const action = mobileConfirm;
    if (!action) return;
    setMobileConfirm(null);

    if (action.kind === 'delete-playlist') {
      await deletePlaylistNow(action.playlist);
      return;
    }
    if (action.kind === 'delete-view') {
      await savedViews.deleteView(action.id);
      return;
    }

    try {
      await offline.remove(action.track.id);
    } catch (error) {
      reportError(error);
    }
  }

  async function scanNow() {
    try {
      const result = await rescan();
      const message = `Biblioteca atualizada: +${result.added} novas, ${result.updated} alteradas, ${result.removed} removidas.`;
      if (desktopLayout) window.alert(message);
      else setMobileNotice(message);
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
    const sharedByCollection = offline.collectionDownloadedIds.has(track.id);
    const message = sharedByCollection
      ? `Remover o download individual de “${track.title}”? A música continuará disponível porque uma coleção offline também depende dela.`
      : `Remover “${track.title}” dos downloads offline?`;

    if (!desktopLayout) {
      setMobileConfirm({ kind: 'remove-download', track, message });
      return;
    }

    if (!window.confirm(message)) return;
    try {
      await offline.remove(track.id);
    } catch (error) {
      reportError(error);
    }
  }

  const offlineTrackProps = {
    offlineSupported: offline.supported,
    downloadedIds: offline.downloadedIds,
    individualDownloadedIds: offline.individualDownloadedIds,
    collectionDownloadedIds: offline.collectionDownloadedIds,
    downloadingIds: offline.downloadingIds,
    onDownload: downloadTrack,
    onRemoveDownload: removeTrackDownload
  };

  const offlineControl = offline.supported && offlineCollectionTarget && offlineCollectionState ? (
    <OfflineCollectionControl
      target={offlineCollectionTarget}
      state={offlineCollectionState}
      onSync={offline.syncCollection}
      onPause={() => offline.pauseCollection(offlineCollectionTarget.kind, offlineCollectionTarget.sourceId)}
      onRemove={() => offline.removeCollection(offlineCollectionTarget.kind, offlineCollectionTarget.sourceId)}
      onError={reportError}
    />
  ) : null;

  const navigationChrome = (
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
      detailMenuOpen={mobileCollectionMenuOpen}
      onToggleDetailMenu={!desktopLayout && isDetail ? () => setMobileCollectionMenuOpen(open => !open) : undefined}
    />
  );

  const viewTools = showViewTools ? (
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
  ) : null;

  const libraryContent = (
    <LibraryContent
      navigation={navigation}
      playlists={playlists}
      tracks={tracks}
      current={current}
      playing={playing}
      offlineTrackProps={offlineTrackProps}
      onPlayTrack={onPlayTrack}
      onTogglePlay={onTogglePlay}
      onCreatePlaylist={makePlaylist}
      onEditPlaylist={editPlaylist}
      onRemovePlaylist={removePlaylist}
      onCreateSmartPlaylist={() => setSmartPlaylistEditor({ playlist: null })}
      onEditSmartPlaylist={playlist => setSmartPlaylistEditor({ playlist })}
      onSetPlaylistTracks={setPlaylistTracks}
    />
  );

  const libraryStatus = (
    <div className="library-status">
      Última indexação: {scannedAt ? new Date(scannedAt).toLocaleString('pt-BR') : 'ainda não realizada'}
    </div>
  );

  const desktopFolderDetail = desktopLayout && libraryTab === 'folders' && Boolean(folderPath);
  const desktopPlaylistDetail = desktopLayout && libraryTab === 'playlists' && Boolean(selectedPlaylist);
  const playlistSummaryTracks = offlineCollectionTarget?.kind === 'playlist'
    ? offlineCollectionTarget.tracks
    : libraryTracks;

  function toggleCollectionPlayback(collectionTracks: Track[]) {
    if (!collectionTracks.length) return;
    const currentInCollection = Boolean(current && collectionTracks.some(track => track.id === current.id));
    if (currentInCollection) onTogglePlay();
    else onPlayTrack(collectionTracks[0], collectionTracks);
  }

  const folderPlaying = Boolean(
    playing
    && current
    && folderView.allTracks.some(track => track.id === current.id)
  );
  const playlistPlaying = Boolean(
    playing
    && current
    && playlistSummaryTracks.some(track => track.id === current.id)
  );
  const mobileCollectionTracks = selectedPlaylist ? playlistSummaryTracks : folderView.allTracks;
  const mobileCollectionName = selectedPlaylist?.name ?? folderView.name;
  const mobileCollectionArtwork = mobileCollectionTracks.find(track => track.hasCover) ?? mobileCollectionTracks[0];
  const mobileCollectionPlaying = selectedPlaylist ? playlistPlaying : folderPlaying;

  useEffect(() => {
    setMobileCollectionMenuOpen(false);
  }, [folderPath, selectedPlaylist?.id]);

  return (
    <>
      {desktopFolderDetail ? (
        <div className="desktop-folder-detail-layout" data-testid="desktop-folder-detail-layout">
          <DesktopFolderSummary
            name={folderView.name}
            tracks={folderView.allTracks}
            downloadedIds={offline.downloadedIds}
            offlineControl={offlineControl}
            playing={folderPlaying}
            onTogglePlayback={() => toggleCollectionPlayback(folderView.allTracks)}
          />
          <section className="desktop-folder-detail-main">
            {libraryContent}
            {libraryStatus}
          </section>
        </div>
      ) : desktopPlaylistDetail && selectedPlaylist ? (
        <div className="desktop-folder-detail-layout desktop-playlist-detail-layout" data-testid="desktop-playlist-detail-layout">
          <DesktopPlaylistSummary
            name={selectedPlaylist.name}
            tracks={playlistSummaryTracks}
            downloadedIds={offline.downloadedIds}
            offlineControl={offlineControl}
            playing={playlistPlaying}
            onTogglePlayback={() => toggleCollectionPlayback(playlistSummaryTracks)}
          />
          <section className="desktop-folder-detail-main desktop-playlist-detail-main">
            {libraryContent}
            {libraryStatus}
          </section>
        </div>
      ) : desktopLayout ? (
        <>
          {navigationChrome}
          {viewTools}
          {libraryContent}
          {libraryStatus}
        </>
      ) : isDetail ? (
        <div className="mobile-collection-detail" data-testid="mobile-collection-detail">
          {navigationChrome}
          <section className="mobile-collection-hero" aria-label={mobileCollectionName}>
            <Artwork track={mobileCollectionArtwork} large />
            <span className="mobile-collection-hero__scrim" aria-hidden="true" />
            <div className="mobile-collection-hero__content">
              <strong>{mobileCollectionName}</strong>
              <small>{mobileCollectionTracks.length} músicas</small>
              <button
                className="mobile-collection-hero__play"
                type="button"
                aria-label={mobileCollectionPlaying ? `Pausar ${mobileCollectionName}` : `Tocar ${mobileCollectionName}`}
                disabled={!mobileCollectionTracks.length}
                onClick={() => toggleCollectionPlayback(mobileCollectionTracks)}
              >
                {mobileCollectionPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </button>
            </div>
          </section>

          <MobileSheet
            open={mobileCollectionMenuOpen}
            title={`Opções de ${mobileCollectionName}`}
            onClose={() => setMobileCollectionMenuOpen(false)}
            className="mobile-collection-actions-sheet"
          >
            {offlineControl && <div className="mobile-sheet-collection-offline">{offlineControl}</div>}
            <div className="mobile-sheet-actions">
              {selectedPlaylist?.source === 'manual' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileCollectionMenuOpen(false);
                      void editPlaylist(selectedPlaylist);
                    }}
                  >
                    <span aria-hidden="true" />
                    <span>Renomear playlist</span>
                    <span aria-hidden="true" />
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    onClick={() => {
                      setMobileCollectionMenuOpen(false);
                      void removePlaylist(selectedPlaylist);
                    }}
                  >
                    <span aria-hidden="true" />
                    <span>Excluir playlist</span>
                    <span aria-hidden="true" />
                  </button>
                </>
              )}
              {selectedPlaylist?.source === 'smart' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileCollectionMenuOpen(false);
                      setSmartPlaylistEditor({ playlist: selectedPlaylist });
                    }}
                  >
                    <span aria-hidden="true" />
                    <span>Editar regra</span>
                    <span aria-hidden="true" />
                  </button>
                  <button
                    className="is-danger"
                    type="button"
                    onClick={() => {
                      setMobileCollectionMenuOpen(false);
                      void removePlaylist(selectedPlaylist);
                    }}
                  >
                    <span aria-hidden="true" />
                    <span>Excluir playlist</span>
                    <span aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
            {!offlineControl && !selectedPlaylist && (
              <span className="mobile-sheet-empty">Nenhuma ação adicional.</span>
            )}
          </MobileSheet>

          {viewTools}
          {libraryContent}
          {libraryStatus}
        </div>
      ) : (
        <>
          {navigationChrome}
          {viewTools}
          {libraryContent}
          {libraryStatus}
        </>
      )}

      {current && (
        <MiniPlayer
          current={current}
          playing={playing}
          hasNext={hasNext}
          currentTime={currentTime}
          duration={duration}
          playlists={editablePlaylists}
          onOpenPlayer={onOpenPlayer}
          onTogglePlay={onTogglePlay}
          onNext={onNext}
          onAddToPlaylist={playlist => {
            void addTrackToPlaylist(playlist, current.id).catch(reportError);
          }}
        />
      )}

      <MobileSheet
        open={Boolean(mobileTextEditor)}
        title={mobileTextEditor?.kind === 'create-playlist'
          ? 'Nova playlist'
          : mobileTextEditor?.kind === 'rename-playlist'
            ? 'Renomear playlist'
            : mobileTextEditor?.kind === 'save-view'
              ? 'Salvar view'
              : 'Renomear view'}
        onClose={() => setMobileTextEditor(null)}
        className="library-text-editor-sheet"
      >
        {mobileTextEditor && (
          <form
            className="mobile-sheet-form"
            onSubmit={event => {
              event.preventDefault();
              void submitMobileTextEditor().catch(reportError);
            }}
          >
            <label className="mobile-sheet-field">
              <span>Nome</span>
              <input
                data-autofocus
                value={mobileTextEditor.value}
                onChange={event => setMobileTextEditor(editor => editor ? { ...editor, value: event.target.value } : editor)}
                autoComplete="off"
              />
            </label>
            <div className="mobile-sheet-form__actions">
              <button type="button" onClick={() => setMobileTextEditor(null)}>Cancelar</button>
              <button className="is-primary" type="submit" disabled={!mobileTextEditor.value.trim()}>Salvar</button>
            </div>
          </form>
        )}
      </MobileSheet>

      <MobileSheet
        open={Boolean(mobileConfirm)}
        title={mobileConfirm?.kind === 'delete-playlist'
          ? 'Excluir playlist'
          : mobileConfirm?.kind === 'delete-view'
            ? 'Excluir view'
            : 'Remover download'}
        onClose={() => setMobileConfirm(null)}
        className="library-confirm-sheet"
      >
        {mobileConfirm && (
          <div className="mobile-sheet-confirm">
            <p>
              {mobileConfirm.kind === 'delete-playlist'
                ? `Excluir a playlist “${mobileConfirm.playlist.name}”?`
                : mobileConfirm.kind === 'delete-view'
                  ? `Excluir a view “${mobileConfirm.name}”?`
                  : mobileConfirm.message}
            </p>
            <div className="mobile-sheet-confirm__actions">
              <button type="button" onClick={() => setMobileConfirm(null)}>Cancelar</button>
              <button
                className="is-danger"
                type="button"
                onClick={() => void confirmMobileAction().catch(reportError)}
              >
                Confirmar
              </button>
            </div>
          </div>
        )}
      </MobileSheet>

      {mobileNotice && <div className="mobile-feedback-toast" role="status">{mobileNotice}</div>}

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
