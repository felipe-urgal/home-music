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
import { LibraryActionDialog } from './LibraryActionDialog';
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

type LibraryTextEditor =
  | { kind: 'create-playlist'; value: string }
  | { kind: 'rename-playlist'; playlist: Playlist; value: string }
  | { kind: 'save-view'; value: string }
  | { kind: 'rename-view'; id: string; currentName: string; value: string };

type LibraryConfirm =
  | { kind: 'delete-playlist'; playlist: Playlist }
  | { kind: 'delete-view'; id: string; name: string }
  | { kind: 'remove-download'; track: Track; message: string };

function actionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

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
  const [textEditor, setTextEditor] = useState<LibraryTextEditor | null>(null);
  const [confirmAction, setConfirmAction] = useState<LibraryConfirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const {
    tracks,
    playlists,
    scanning,
    scannedAt,
    rescan,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    previewSmartPlaylist,
    createSmartPlaylist,
    updateSmartPlaylist,
    deleteSmartPlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
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
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
    setDialogError(null);
    setTextEditor({ kind: 'create-playlist', value: '' });
  }

  async function editPlaylist(playlist: Playlist) {
    setDialogError(null);
    setTextEditor({ kind: 'rename-playlist', playlist, value: playlist.name });
  }

  async function deletePlaylistNow(playlist: Playlist) {
    if (playlist.source === 'smart') await deleteSmartPlaylist(playlist.id);
    else await deletePlaylist(playlist.id);
    if (desktopLayout) selectTab('folders');
    else leavePlaylist();
  }

  async function removePlaylist(playlist: Playlist) {
    setDialogError(null);
    setConfirmAction({ kind: 'delete-playlist', playlist });
  }

  async function saveCurrentView() {
    setViewControlsOpen(false);
    setDialogError(null);
    setTextEditor({ kind: 'save-view', value: '' });
  }

  async function renameSavedView(id: string, currentName: string) {
    setViewControlsOpen(false);
    setDialogError(null);
    setTextEditor({ kind: 'rename-view', id, currentName, value: currentName });
  }

  async function removeSavedView(id: string, name: string) {
    setViewControlsOpen(false);
    setDialogError(null);
    setConfirmAction({ kind: 'delete-view', id, name });
  }

  async function submitTextEditor() {
    const editor = textEditor;
    const name = editor?.value.trim() ?? '';
    if (!editor || !name || dialogBusy) return;

    const unchanged = editor.kind === 'rename-playlist'
      ? name === editor.playlist.name
      : editor.kind === 'rename-view'
        ? name === editor.currentName
        : false;
    if (unchanged) {
      setTextEditor(null);
      return;
    }

    setDialogBusy(true);
    setDialogError(null);
    try {
      if (editor.kind === 'create-playlist') await createPlaylist(name);
      else if (editor.kind === 'rename-playlist') await renamePlaylist(editor.playlist.id, name);
      else if (editor.kind === 'save-view') await savedViews.createView(name, currentViewDefinition);
      else await savedViews.renameView(editor.id, name);
      setTextEditor(null);
    } catch (error) {
      setDialogError(actionErrorMessage(error));
    } finally {
      setDialogBusy(false);
    }
  }

  async function confirmActionNow() {
    const action = confirmAction;
    if (!action || dialogBusy) return;

    setDialogBusy(true);
    setDialogError(null);
    try {
      if (action.kind === 'delete-playlist') await deletePlaylistNow(action.playlist);
      else if (action.kind === 'delete-view') await savedViews.deleteView(action.id);
      else await offline.remove(action.track.id);
      setConfirmAction(null);
    } catch (error) {
      setDialogError(actionErrorMessage(error));
      if (action.kind === 'remove-download') reportError(error);
    } finally {
      setDialogBusy(false);
    }
  }

  async function scanNow() {
    try {
      const result = await rescan();
      setNotice(
        `Biblioteca atualizada: +${result.added} novas, ${result.updated} alteradas, ${result.removed} removidas.`
      );
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

    setDialogError(null);
    setConfirmAction({ kind: 'remove-download', track, message });
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
      onRemovePlaylistTrack={removeTrackFromPlaylist}
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

  const textEditorTitle = textEditor?.kind === 'create-playlist'
    ? 'Nova playlist'
    : textEditor?.kind === 'rename-playlist'
      ? 'Renomear playlist'
      : textEditor?.kind === 'save-view'
        ? 'Salvar view'
        : 'Renomear view';
  const textEditorDescription = textEditor?.kind === 'create-playlist'
    ? 'Crie uma playlist manual para organizar suas músicas.'
    : textEditor?.kind === 'save-view'
      ? 'Salve a combinação atual de filtros e ordenação.'
      : 'Escolha um nome claro para encontrar este item rapidamente.';
  const textEditorConfirmLabel = textEditor?.kind === 'create-playlist'
    ? 'Criar playlist'
    : textEditor?.kind === 'save-view'
      ? 'Salvar view'
      : 'Salvar';
  const textEditorName = textEditor?.value.trim() ?? '';
  const textEditorUnchanged = textEditor?.kind === 'rename-playlist'
    ? textEditorName === textEditor.playlist.name
    : textEditor?.kind === 'rename-view'
      ? textEditorName === textEditor.currentName
      : false;
  const confirmTitle = confirmAction?.kind === 'delete-playlist'
    ? 'Excluir playlist'
    : confirmAction?.kind === 'delete-view'
      ? 'Excluir view'
      : 'Remover download';
  const confirmMessage = confirmAction?.kind === 'delete-playlist'
    ? `Excluir a playlist “${confirmAction.playlist.name}”? Esta ação não pode ser desfeita.`
    : confirmAction?.kind === 'delete-view'
      ? `Excluir a view “${confirmAction.name}”? Esta ação não pode ser desfeita.`
      : confirmAction?.message ?? '';
  const confirmLabel = confirmAction?.kind === 'remove-download' ? 'Remover download' : 'Excluir';

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
        open={!desktopLayout && Boolean(textEditor)}
        title={textEditorTitle}
        onClose={() => {
          if (!dialogBusy) {
            setTextEditor(null);
            setDialogError(null);
          }
        }}
        className="library-text-editor-sheet"
      >
        {textEditor && (
          <form
            className="mobile-sheet-form"
            onSubmit={event => {
              event.preventDefault();
              void submitTextEditor();
            }}
          >
            <label className="mobile-sheet-field">
              <span>Nome</span>
              <input
                data-autofocus
                value={textEditor.value}
                onChange={event => setTextEditor(editor => editor ? { ...editor, value: event.target.value } : editor)}
                autoComplete="off"
                disabled={dialogBusy}
              />
            </label>
            <div className="mobile-sheet-form__actions">
              <button type="button" disabled={dialogBusy} onClick={() => setTextEditor(null)}>Cancelar</button>
              <button
                className="is-primary"
                type="submit"
                disabled={dialogBusy || !textEditor.value.trim() || textEditorUnchanged}
              >
                {dialogBusy ? 'Aguarde…' : textEditorConfirmLabel}
              </button>
            </div>
          </form>
        )}
      </MobileSheet>

      <MobileSheet
        open={!desktopLayout && Boolean(confirmAction)}
        title={confirmTitle}
        onClose={() => {
          if (!dialogBusy) {
            setConfirmAction(null);
            setDialogError(null);
          }
        }}
        className="library-confirm-sheet"
      >
        {confirmAction && (
          <div className="mobile-sheet-confirm">
            <p>
              {confirmMessage}
            </p>
            <div className="mobile-sheet-confirm__actions">
              <button type="button" disabled={dialogBusy} onClick={() => setConfirmAction(null)}>Cancelar</button>
              <button
                className="is-danger"
                type="button"
                disabled={dialogBusy}
                onClick={() => void confirmActionNow()}
              >
                {dialogBusy ? 'Aguarde…' : confirmLabel}
              </button>
            </div>
          </div>
        )}
      </MobileSheet>

      {desktopLayout && (
        <>
          <LibraryActionDialog
            open={Boolean(textEditor)}
            title={textEditorTitle}
            description={textEditorDescription}
            value={textEditor?.value}
            placeholder={textEditor?.kind === 'create-playlist' ? 'Ex.: Favoritas para trabalhar' : undefined}
            confirmLabel={textEditorConfirmLabel}
            busy={dialogBusy}
            error={dialogError}
            confirmDisabled={!textEditorName || textEditorUnchanged}
            onValueChange={value => setTextEditor(editor => editor ? { ...editor, value } : editor)}
            onConfirm={() => void submitTextEditor()}
            onClose={() => {
              setTextEditor(null);
              setDialogError(null);
            }}
          />
          <LibraryActionDialog
            open={Boolean(confirmAction)}
            title={confirmTitle}
            description={confirmMessage}
            confirmLabel={confirmLabel}
            danger
            busy={dialogBusy}
            error={dialogError}
            onConfirm={() => void confirmActionNow()}
            onClose={() => {
              setConfirmAction(null);
              setDialogError(null);
            }}
          />
        </>
      )}

      {notice && <div className="library-feedback-toast" role="status">{notice}</div>}

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
