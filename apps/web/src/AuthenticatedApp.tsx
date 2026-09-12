import { lazy, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import { DesktopNowPlayingScreen } from './components/DesktopNowPlayingScreen';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopPlayerSidebarTools } from './components/DesktopPlayerSidebarTools';
import { DesktopShell } from './components/DesktopShell';
import { LazySurfaceBoundary } from './components/LazySurfaceBoundary';
import { LibraryScreen } from './components/LibraryScreen';
import { MobileBottomNav } from './components/MobileBottomNav';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import { TvExperience } from './components/TvExperience';
import { useRoutedScreen } from './browser-navigation';
import { canUseAdminLibraryActions } from './frontend-access';
import { buildLibraryReturnLabel } from './library-utils';
import type { OfflineDownloads } from './offline-downloads';
import { isTvMode } from './tv-mode';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useCrossfadeAudioPlayer } from './useCrossfadeAudioPlayer';
import { useDesktopLayout } from './useDesktopLayout';
import { useLibraryData } from './useLibraryData';
import { type LibraryTab, useLibraryNavigation } from './useLibraryNavigation';
import { useNetworkQualityProfile } from './useNetworkQualityProfile';
import { useNextTrackPreload } from './useNextTrackPreload';
import { useSystemVolumePreference } from './useSystemVolume';

const AdministrationScreen = lazy(async () => {
  const module = await import('./components/AdministrationScreen');
  return { default: module.AdministrationScreen };
});

const MyAccountScreen = lazy(async () => {
  const module = await import('./components/MyAccountScreen');
  return { default: module.MyAccountScreen };
});

type AdministrationReturnScreen = 'library' | 'account';

type AuthenticatedAppProps = {
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
  onAuthRefresh: () => Promise<void>;
  onOpenOffline: () => void;
  offline: OfflineDownloads;
};

export function AuthenticatedApp({ currentUser, onLogout, onAuthRefresh, onOpenOffline, offline }: AuthenticatedAppProps) {
  const [administrationReturnScreen, setAdministrationReturnScreen] = useState<AdministrationReturnScreen>('account');
  const library = useLibraryData();
  const libraryReady = !library.loading && !library.error;
  const navigation = useLibraryNavigation(library.tracks, library.playlists, libraryReady, library.revision);
  const canManageSharedLibrary = canUseAdminLibraryActions(currentUser);
  const [screen, setScreen] = useRoutedScreen({
    libraryPath: navigation.routePath,
    canAccessAdmin: canManageSharedLibrary
  });
  const usesSystemVolume = useSystemVolumePreference();
  const desktopLayout = useDesktopLayout();
  const player = useCrossfadeAudioPlayer(library.tracks, screen === 'player' || desktopLayout, libraryReady, usesSystemVolume);
  const qualityProfile = useNetworkQualityProfile(player.streamingMode, player.setStreamingMode);
  useBackgroundPlaybackContinuity({
    audioRef: player.audioRef,
    queue: player.queue,
    currentIndex: player.currentIndex,
    currentTrackId: player.current?.id ?? null,
    repeatMode: player.repeatMode,
    playing: player.playing,
    onNext: player.next
  });
  useNextTrackPreload({
    queue: player.queue,
    currentIndex: player.currentIndex,
    repeatMode: player.repeatMode,
    streamingMode: player.streamingMode,
    normalizationMode: player.normalizationMode,
    playing: player.playing
  });
  const current = player.current;
  const currentHasPhysicalDownload = Boolean(current && offline.downloadedIds.has(current.id));
  const currentHasIndividualDownload = Boolean(currentHasPhysicalDownload && current && offline.individualDownloadedIds.has(current.id));
  const currentAvailableViaCollection = Boolean(currentHasPhysicalDownload && current && offline.collectionDownloadedIds.has(current.id));
  const editablePlaylists = library.playlists.filter(playlist => playlist.source === 'manual');
  const libraryReturnLabel = buildLibraryReturnLabel({
    selectedPlaylistName: navigation.selectedPlaylist?.name,
    libraryTab: navigation.libraryTab,
    folderPath: navigation.folderPath,
    folderName: navigation.folderView.name,
    query: navigation.query
  });

  function openPlayer() {
    player.syncVisibleProgress();
    setScreen('player');
  }

  function openLibraryTab(tab: LibraryTab) {
    navigation.selectTab(tab);
  }

  function openAdministration(returnScreen: AdministrationReturnScreen) {
    if (!canManageSharedLibrary) return;
    setAdministrationReturnScreen(returnScreen);
    setScreen('admin');
  }

  function run(operation: Promise<unknown>) {
    void operation.catch(() => undefined);
  }

  async function refreshLibrary() {
    try {
      const result = await library.rescan();
      window.alert(`Biblioteca atualizada: +${result.added} novas, ${result.updated} alteradas, ${result.removed} removidas.`);
    } catch {
      // useLibraryData já exibe o erro globalmente.
    }
  }

  function toggleDownload() {
    if (!current) return;
    if (currentHasIndividualDownload) {
      const message = currentAvailableViaCollection
        ? `Remover o download individual de “${current.title}”? A música continuará disponível porque uma coleção offline também depende dela.`
        : `Remover “${current.title}” dos downloads offline?`;
      if (!window.confirm(message)) return;
      run(offline.remove(current.id).catch(error => {
        library.reportError(error);
        throw error;
      }));
      return;
    }

    run(offline.download(current).catch(error => {
      library.reportError(error);
      throw error;
    }));
  }

  const accountArea = screen === 'account';
  const administrationArea = screen === 'admin';
  const utilityArea = accountArea || administrationArea;
  const desktopScreen = screen === 'player' ? 'player' : 'library';
  const mobileNavigationActive = utilityArea ? 'account' : screen === 'library' ? 'library' : 'player';
  const showAdminEntry = !desktopLayout
    && canManageSharedLibrary
    && !utilityArea
    && (screen === 'library' || Boolean(library.error));
  const showMyAccountEntry = !desktopLayout
    && !utilityArea
    && (screen === 'library' || Boolean(library.error) || !current);
  const tvMode = isTvMode();

  const audioDecks = (
    <>
      <audio
        ref={player.deckARef}
        preload="auto"
        onPlay={event => player.audioHandlers.onPlay(event.currentTarget)}
        onPlaying={event => player.audioHandlers.onPlaying(event.currentTarget)}
        onPause={event => player.audioHandlers.onPause(event.currentTarget)}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={event => player.audioHandlers.onEnded(event.currentTarget)}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />
      <audio
        ref={player.deckBRef}
        preload="auto"
        aria-hidden="true"
        onPlay={event => player.audioHandlers.onPlay(event.currentTarget)}
        onPlaying={event => player.audioHandlers.onPlaying(event.currentTarget)}
        onPause={event => player.audioHandlers.onPause(event.currentTarget)}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={event => player.audioHandlers.onEnded(event.currentTarget)}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />
    </>
  );

  if (tvMode && !utilityArea) {
    if (library.loading) {
      return <main className="app-shell tv-app">{audioDecks}<ResponsiveState variant="loading" title="Carregando sua biblioteca" detail="Preparando o Home Music para a TV." /></main>;
    }
    if (library.error) {
      return (
        <main className="app-shell tv-app">
          {audioDecks}
          <ResponsiveState variant="error" title="Servidor indisponível" detail={library.error}>
            <button className="primary-action" onClick={() => run(library.retry())}>Tentar novamente</button>
          </ResponsiveState>
        </main>
      );
    }
    if (library.tracks.length > 0 && !player.hydrated) {
      return <main className="app-shell tv-app">{audioDecks}<ResponsiveState variant="loading" title="Restaurando o player" detail="Recuperando sua fila e a última faixa reproduzida." /></main>;
    }

    return (
      <>
        {audioDecks}
        <TvExperience
          username={currentUser.username}
          tracks={library.tracks}
          playlists={library.playlists}
          navigation={navigation}
          current={current}
          playing={player.playing}
          currentTime={player.currentTime}
          duration={player.duration}
          volume={player.volume}
          usesSystemVolume={usesSystemVolume}
          onTogglePlay={() => void player.togglePlay()}
          onPrevious={player.previous}
          onNext={player.next}
          onSeek={player.seek}
          onVolume={player.setVolume}
          onPlayTrack={player.playTrack}
          onOpenAccount={() => setScreen('account')}
        />
        {library.actionError && (
          <button className="app-toast" role="status" onClick={library.clearActionError}>{library.actionError}</button>
        )}
      </>
    );
  }

  return (
    <main className="app-shell">
      {audioDecks}

      <DesktopShell
        active={desktopScreen}
        activeLibraryTab={screen === 'library' ? navigation.libraryTab : undefined}
        current={current}
        playing={player.playing}
        currentTime={player.currentTime}
        libraryCount={library.tracks.length}
        queue={player.queue}
        currentIndex={player.currentIndex}
        canRefreshLibrary={desktopLayout && canManageSharedLibrary}
        libraryRefreshing={library.scanning}
        onRefreshLibrary={() => { void refreshLibrary(); }}
        onOpenPlayer={openPlayer}
        onOpenLibrary={() => setScreen('library')}
        onOpenLibraryTab={openLibraryTab}
        onPlayTrack={player.playTrack}
        onReorderQueue={player.reorderQueue}
        sidebarUtilities={desktopLayout ? (
          <DesktopPlayerSidebarTools
            username={currentUser.username}
            accountActive={accountArea}
            onOpenAccount={() => setScreen('account')}
          />
        ) : undefined}
        surfaceClassName={`phone-surface phone-surface--mobile-nav ${screen !== 'player' ? 'phone-surface--library' : ''} ${desktopLayout && screen === 'player' ? 'desktop-now-playing-surface' : ''} ${desktopLayout && utilityArea ? 'desktop-account-surface' : ''}`.trim()}
      >
        {showMyAccountEntry && (
          <button className="my-account-mobile-entry" type="button" onClick={() => setScreen('account')}>
            Minha conta · {currentUser.username}
          </button>
        )}

        {showAdminEntry && (
          <button className="admin-mobile-entry" type="button" onClick={() => openAdministration('library')}>
            Administração
          </button>
        )}

        {screen === 'account' ? (
          <LazySurfaceBoundary loadingTitle="Carregando Minha conta">
            <MyAccountScreen
              currentUser={currentUser}
              playbackPreferences={{
                current,
                streamingSelection: qualityProfile.selection,
                effectiveStreamingMode: qualityProfile.effectiveMode,
                networkPreference: qualityProfile.networkPreference,
                detectedNetwork: qualityProfile.detectedNetwork,
                crossfadeSeconds: player.crossfadeSeconds,
                normalizationMode: player.normalizationMode,
                effectiveNormalizationMode: player.effectiveNormalizationMode,
                onStreamingSelection: qualityProfile.setSelection,
                onNetworkPreference: qualityProfile.setNetworkPreference,
                onCrossfadeSeconds: player.setCrossfadeSeconds,
                onNormalizationMode: player.setNormalizationMode
              }}
              offlineMode={{
                supported: offline.supported,
                loading: offline.loading,
                availableCount: offline.tracks.length,
                onOpen: onOpenOffline
              }}
              onBack={() => setScreen('library')}
              onOpenAdministration={() => openAdministration('account')}
              onSessionEnded={onAuthRefresh}
              onLogout={onLogout}
            />
          </LazySurfaceBoundary>
        ) : screen === 'admin' && canManageSharedLibrary ? (
          <LazySurfaceBoundary loadingTitle="Carregando Administração">
            <AdministrationScreen
              currentUser={currentUser}
              onBack={() => setScreen(administrationReturnScreen)}
            />
          </LazySurfaceBoundary>
        ) : library.loading ? (
          <ResponsiveState
            variant="loading"
            title="Carregando sua biblioteca"
            detail="Sincronizando músicas e playlists."
          />
        ) : library.error ? (
          <ResponsiveState variant="error" title="Servidor indisponível" detail={library.error}>
            <button className="primary-action" onClick={() => run(library.retry())}>Tentar novamente</button>
          </ResponsiveState>
        ) : library.tracks.length > 0 && !player.hydrated ? (
          <ResponsiveState
            variant="loading"
            title="Restaurando o player"
            detail="Recuperando sua fila e a última faixa reproduzida."
          />
        ) : screen === 'library' ? (
          <LibraryScreen
            currentUser={currentUser}
            data={library}
            offline={offline}
            current={current}
            playing={player.playing}
            hasNext={player.hasNext}
            currentTime={player.currentTime}
            duration={player.duration}
            navigation={navigation}
            onOpenPlayer={openPlayer}
            onTogglePlay={() => void player.togglePlay()}
            onNext={player.next}
            onPlayTrack={player.playTrack}
          />
        ) : !current ? (
          <ResponsiveState
            variant="empty"
            title="Nenhuma música encontrada"
            detail={canManageSharedLibrary
              ? 'Confira MUSIC_DIR ou atualize a biblioteca para procurar músicas novas.'
              : 'A biblioteca compartilhada ainda não possui músicas disponíveis.'}
          >
            {canManageSharedLibrary && (
              <button className="primary-action" disabled={library.scanning} onClick={() => run(library.rescan())}>
                {library.scanning ? 'Atualizando…' : 'Atualizar biblioteca'}
              </button>
            )}
            <button className="secondary-action" onClick={() => setScreen('library')}>Abrir biblioteca</button>
          </ResponsiveState>
        ) : desktopLayout ? (
          <DesktopNowPlayingScreen
            current={current}
            playing={player.playing}
            autoplayBlocked={player.autoplayBlocked}
            playbackError={player.sourceError}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
            usesSystemVolume={usesSystemVolume}
            shuffle={player.shuffle}
            repeatMode={player.repeatMode}
            playlists={editablePlaylists}
            isDownloaded={currentHasIndividualDownload}
            availableViaCollection={currentAvailableViaCollection}
            downloading={offline.downloadingIds.has(current.id)}
            onTogglePlay={() => void player.togglePlay()}
            onPrevious={player.previous}
            onNext={player.next}
            onSeek={player.seek}
            onVolume={player.setVolume}
            onShuffle={player.toggleShuffle}
            onRepeat={player.cycleRepeat}
            onToggleDownload={offline.supported ? toggleDownload : undefined}
            onAddToPlaylist={playlist => run(library.addTrackToPlaylist(playlist, current.id))}
          />
        ) : (
          <PlayerScreen
            current={current}
            libraryReturnLabel={libraryReturnLabel}
            queue={player.queue}
            currentIndex={player.currentIndex}
            playing={player.playing}
            autoplayBlocked={player.autoplayBlocked}
            playbackError={player.sourceError}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
            usesSystemVolume={usesSystemVolume}
            shuffle={player.shuffle}
            repeatMode={player.repeatMode}
            playlists={editablePlaylists}
            isDownloaded={currentHasIndividualDownload}
            availableViaCollection={currentAvailableViaCollection}
            downloading={offline.downloadingIds.has(current.id)}
            onOpenLibrary={() => setScreen('library')}
            onTogglePlay={() => void player.togglePlay()}
            onPrevious={player.previous}
            onNext={player.next}
            onSeek={player.seek}
            onVolume={player.setVolume}
            onShuffle={player.toggleShuffle}
            onRepeat={player.cycleRepeat}
            onToggleDownload={offline.supported ? toggleDownload : undefined}
            onPlayTrack={player.playTrack}
            onReorderQueue={player.reorderQueue}
            onAddToPlaylist={playlist => run(library.addTrackToPlaylist(playlist, current.id))}
          />
        )}
      </DesktopShell>

      <MobileBottomNav
        active={mobileNavigationActive}
        onOpenPlayer={openPlayer}
        onOpenLibrary={() => setScreen('library')}
        onOpenAccount={() => setScreen('account')}
      />

      <DesktopPlayerBar
        current={current}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        usesSystemVolume={usesSystemVolume}
        hasNext={player.hasNext}
        onOpenPlayer={openPlayer}
        onTogglePlay={() => void player.togglePlay()}
        onPrevious={player.previous}
        onNext={player.next}
        onSeek={player.seek}
        onVolume={player.setVolume}
      />

      {library.actionError && (
        <button className="app-toast" role="status" onClick={library.clearActionError}>
          {library.actionError}
        </button>
      )}
    </main>
  );
}
