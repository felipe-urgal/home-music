import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import { AdministrationScreen } from './components/AdministrationScreen';
import { DesktopNowPlayingScreen } from './components/DesktopNowPlayingScreen';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopPlayerSidebarTools } from './components/DesktopPlayerSidebarTools';
import { DesktopShell } from './components/DesktopShell';
import { LibraryScreen } from './components/LibraryScreen';
import { LoginScreen } from './components/LoginScreen';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MyAccountScreen } from './components/MyAccountScreen';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import { useRoutedScreen } from './browser-navigation';
import { canUseAdminLibraryActions } from './frontend-access';
import { buildLibraryReturnLabel } from './library-utils';
import { type OfflineDownloads, useOfflineDownloads } from './offline-downloads';
import { useAudioPlayer } from './useAudioPlayer';
import { useAuth } from './useAuth';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useDesktopLayout } from './useDesktopLayout';
import { useLibraryData } from './useLibraryData';
import { type LibraryTab, useLibraryNavigation } from './useLibraryNavigation';
import { useNetworkQualityProfile } from './useNetworkQualityProfile';
import { useNextTrackPreload } from './useNextTrackPreload';
import { useSystemVolumePreference } from './useSystemVolume';

type Screen = 'player' | 'library' | 'admin' | 'account';
type AdministrationReturnScreen = 'library' | 'account';

type AuthenticatedAppProps = {
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
  onAuthRefresh: () => Promise<void>;
  offline: OfflineDownloads;
};

function AuthenticatedApp({ currentUser, onLogout, onAuthRefresh, offline }: AuthenticatedAppProps) {
  const [administrationReturnScreen, setAdministrationReturnScreen] = useState<AdministrationReturnScreen>('account');
  const library = useLibraryData();
  const libraryReady = !library.loading && !library.error;
  const navigation = useLibraryNavigation(library.tracks, library.playlists, libraryReady);
  const canManageSharedLibrary = canUseAdminLibraryActions(currentUser);
  const [screen, setScreen] = useRoutedScreen({
    libraryPath: navigation.routePath,
    canAccessAdmin: canManageSharedLibrary
  });
  const usesSystemVolume = useSystemVolumePreference();
  const desktopLayout = useDesktopLayout();
  const player = useAudioPlayer(library.tracks, screen === 'player' || desktopLayout, libraryReady, usesSystemVolume);
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
    if (offline.downloadedIds.has(current.id)) {
      if (!window.confirm(`Remover “${current.title}” dos downloads offline?`)) return;
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

  return (
    <main className="app-shell">
      <audio
        ref={player.audioRef}
        onPlay={player.audioHandlers.onPlay}
        onPause={player.audioHandlers.onPause}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={player.audioHandlers.onEnded}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />

      <DesktopShell
        screen={desktopScreen}
        libraryTab={navigation.libraryTab}
        currentTrack={current}
        playing={player.playing}
        onOpenPlayer={openPlayer}
        onOpenLibraryTab={openLibraryTab}
        onOpenAccount={() => setScreen('account')}
      >
        {screen === 'player' ? (
          <DesktopNowPlayingScreen
            current={current}
            playing={player.playing}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
            muted={player.muted}
            normalizationMode={player.normalizationMode}
            repeatMode={player.repeatMode}
            shuffled={player.shuffled}
            onTogglePlay={player.togglePlay}
            onPrevious={player.previous}
            onNext={player.next}
            onSeek={player.seek}
            onVolumeChange={player.setVolume}
            onToggleMute={player.toggleMute}
            onNormalizationModeChange={player.setNormalizationMode}
            onCycleRepeat={player.cycleRepeat}
            onToggleShuffle={player.toggleShuffle}
            onOpenLibrary={() => openLibraryTab('folders')}
          />
        ) : screen === 'library' ? (
          <LibraryScreen
            library={library}
            navigation={navigation}
            player={player}
            offline={offline}
            canManageSharedLibrary={canManageSharedLibrary}
            onOpenAdministration={() => openAdministration('library')}
            onOpenAccount={() => setScreen('account')}
            onRefreshLibrary={refreshLibrary}
          />
        ) : null}

        {!utilityArea ? (
          <DesktopPlayerSidebarTools
            current={current}
            queue={player.queue}
            currentIndex={player.currentIndex}
            onPlayTrack={player.playTrack}
            onRemoveQueueTrack={player.removeQueueTrack}
            onReorderQueue={player.reorderQueue}
          />
        ) : null}
      </DesktopShell>

      {!desktopLayout && !utilityArea ? (
        <>
          {screen === 'player' ? (
            <PlayerScreen
              current={current}
              playing={player.playing}
              currentTime={player.currentTime}
              duration={player.duration}
              volume={player.volume}
              muted={player.muted}
              normalizationMode={player.normalizationMode}
              repeatMode={player.repeatMode}
              shuffled={player.shuffled}
              onTogglePlay={player.togglePlay}
              onPrevious={player.previous}
              onNext={player.next}
              onSeek={player.seek}
              onVolumeChange={player.setVolume}
              onToggleMute={player.toggleMute}
              onNormalizationModeChange={player.setNormalizationMode}
              onCycleRepeat={player.cycleRepeat}
              onToggleShuffle={player.toggleShuffle}
              onOpenLibrary={() => openLibraryTab('folders')}
              onToggleDownload={toggleDownload}
              downloaded={current ? offline.downloadedIds.has(current.id) : false}
              downloading={current ? offline.downloadingIds.has(current.id) : false}
            />
          ) : (
            <LibraryScreen
              library={library}
              navigation={navigation}
              player={player}
              offline={offline}
              canManageSharedLibrary={canManageSharedLibrary}
              onOpenAdministration={() => openAdministration('library')}
              onOpenAccount={() => setScreen('account')}
              onRefreshLibrary={refreshLibrary}
            />
          )}

          <MobileBottomNav
            active={mobileNavigationActive}
            onOpenPlayer={openPlayer}
            onOpenLibrary={() => openLibraryTab('folders')}
            onOpenAccount={() => setScreen('account')}
          />
        </>
      ) : null}

      {accountArea ? (
        <MyAccountScreen
          currentUser={currentUser}
          onBack={() => setScreen('player')}
          onOpenAdministration={() => openAdministration('account')}
          onLogout={onLogout}
          onAuthRefresh={onAuthRefresh}
        />
      ) : null}

      {administrationArea && canManageSharedLibrary ? (
        <AdministrationScreen
          currentUser={currentUser}
          onBack={() => setScreen(administrationReturnScreen)}
          onLibraryChanged={library.refreshAll}
        />
      ) : null}

      {library.error ? <ResponsiveState message={library.error} onRetry={library.retry} /> : null}
      {library.actionError ? <div className="toast-error" role="alert">{library.actionError}</div> : null}
    </main>
  );
}

function OfflineApp({ offline }: { offline: OfflineDownloads }) {
  const [screen, setScreen] = useState<'player' | 'library'>('library');
  const usesSystemVolume = useSystemVolumePreference();
  const player = useAudioPlayer(offline.tracks, true, true, usesSystemVolume);
  const desktopLayout = useDesktopLayout();
  const current = player.current;

  return (
    <main className="app-shell offline-app-shell">
      <audio
        ref={player.audioRef}
        onPlay={player.audioHandlers.onPlay}
        onPause={player.audioHandlers.onPause}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={player.audioHandlers.onEnded}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />

      {screen === 'player' && current ? (
        <PlayerScreen
          current={current}
          playing={player.playing}
          currentTime={player.currentTime}
          duration={player.duration}
          volume={player.volume}
          muted={player.muted}
          normalizationMode={player.normalizationMode}
          repeatMode={player.repeatMode}
          shuffled={player.shuffled}
          onTogglePlay={player.togglePlay}
          onPrevious={player.previous}
          onNext={player.next}
          onSeek={player.seek}
          onVolumeChange={player.setVolume}
          onToggleMute={player.toggleMute}
          onNormalizationModeChange={player.setNormalizationMode}
          onCycleRepeat={player.cycleRepeat}
          onToggleShuffle={player.toggleShuffle}
          onOpenLibrary={() => setScreen('library')}
          onToggleDownload={() => undefined}
          downloaded
          downloading={false}
        />
      ) : (
        <OfflineLibraryScreen
          tracks={offline.tracks}
          onPlay={track => {
            player.playTrack(track);
            setScreen('player');
          }}
        />
      )}

      {!desktopLayout ? (
        <MobileBottomNav
          active={screen}
          onOpenPlayer={() => setScreen('player')}
          onOpenLibrary={() => setScreen('library')}
          onOpenAccount={() => undefined}
          accountDisabled
        />
      ) : null}
    </main>
  );
}

export function App() {
  const auth = useAuth();
  const offline = useOfflineDownloads(auth.currentUser?.id ?? null);

  useEffect(() => {
    if (auth.authenticated) return;
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
  }, [auth.authenticated]);

  if (auth.loading) return <ResponsiveState message="Carregando…" />;

  if (!auth.authenticated) {
    if (offline.available && !navigator.onLine) return <OfflineApp offline={offline} />;
    return (
      <LoginScreen
        error={auth.error}
        requiresPasswordChange={auth.requiresPasswordChange}
        temporaryUsername={auth.temporaryUsername}
        onLogin={auth.login}
        onChangePassword={auth.changeRequiredPassword}
      />
    );
  }

  return (
    <AuthenticatedApp
      currentUser={auth.currentUser!}
      onLogout={auth.logout}
      onAuthRefresh={auth.refresh}
      offline={offline}
    />
  );
}
