import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import { DesktopNowPlayingScreen } from './components/DesktopNowPlayingScreen';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopPlayerSidebarTools } from './components/DesktopPlayerSidebarTools';
import { DesktopShell } from './components/DesktopShell';
import { LazySurfaceBoundary } from './components/LazySurfaceBoundary';
import { LibraryScreen } from './components/LibraryScreen';
import { MobileBottomNav } from './components/MobileBottomNav';
import { MobileSheet } from './components/MobileSheet';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import { TvExperience } from './components/TvExperience';
import { TvRemoteEntryButton } from './components/TvRemoteEntryButton';
import { TvRemotePairingDialog } from './components/TvRemotePairingDialog';
import { useRoutedScreen } from './browser-navigation';
import { decodeDdj400Message } from './ddj400-mapping';
import { Ddj400MixerMapper } from './ddj400-mixer-mapping';
import {
  Ddj400LedRenderer,
  type Ddj400LedState
} from './ddj400-led-feedback';
import {
  DDJ400_NUDGE_RATE_DELTA,
  DDJ400_SCRUB_SECONDS,
  Ddj400PerformanceMapper
} from './ddj400-performance-mapping';
import { resolveBeatmatchPlan } from './beatmatch';
import type { DjDeckId } from './dj-controller-contract';
import { canUseAdminLibraryActions } from './frontend-access';
import { buildLibraryReturnLabel } from './library-utils';
import type { OfflineDownloads } from './offline-downloads';
import { nextTrackDecision } from './player-state';
import { isTvMode } from './tv-mode';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useCrossfadeAudioPlayer } from './useCrossfadeAudioPlayer';
import { useDesktopLayout } from './useDesktopLayout';
import { useLibraryData } from './useLibraryData';
import { type LibraryTab, useLibraryNavigation } from './useLibraryNavigation';
import { useNetworkQualityProfile } from './useNetworkQualityProfile';
import { useNextTrackPreload } from './useNextTrackPreload';
import { useSystemVolumePreference } from './useSystemVolume';
import { useTvRemoteSession } from './useTvRemoteSession';
import { useWebMidiController } from './useWebMidiController';

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
  const [mobileDownloadRemoval, setMobileDownloadRemoval] = useState<{
    id: string;
    title: string;
    availableViaCollection: boolean;
  } | null>(null);
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
  const cancelPreloadRef = useRef<(() => void) | null>(null);
  const cancelPreload = useCallback(() => cancelPreloadRef.current?.(), []);
  const player = useCrossfadeAudioPlayer(
    library.tracks,
    screen === 'player' || desktopLayout,
    libraryReady,
    usesSystemVolume,
    { beforeManualPlaybackChange: cancelPreload }
  );
  const ddjBrowserIndexRef = useRef(0);
  const ddjCuePointsRef = useRef<Record<DjDeckId, number | null>>({ a: null, b: null });
  const ddjSyncActiveRef = useRef<Record<DjDeckId, boolean>>({ a: false, b: false });
  const ddjLedRendererRef = useRef<Ddj400LedRenderer | null>(null);
  const ddjLedFrameRef = useRef<number | null>(null);
  const renderDdjLedsRef = useRef<(() => void) | null>(null);
  const ddjPerformanceMapperRef = useRef(new Ddj400PerformanceMapper());
  const ddjMixerMapperRef = useRef(new Ddj400MixerMapper());
  const ddjBaseRateRef = useRef<Record<DjDeckId, number>>({ a: 1, b: 1 });
  const mixerUiFrameRef = useRef<number | null>(null);
  const [djMixerState, setDjMixerState] = useState(() => player.dualDeck.getMixerSnapshot());

  const scheduleMixerUiSync = useCallback(() => {
    if (mixerUiFrameRef.current != null) return;
    mixerUiFrameRef.current = window.requestAnimationFrame(() => {
      mixerUiFrameRef.current = null;
      setDjMixerState(player.dualDeck.getMixerSnapshot());
    });
  }, [player.dualDeck.getMixerSnapshot]);
  const ddjNudgeTimerRef = useRef<Record<DjDeckId, number | null>>({ a: null, b: null });

  const handleDdj400Message = useCallback((message: Parameters<typeof decodeDdj400Message>[0]) => {
    const command = decodeDdj400Message(message)
      ?? ddjPerformanceMapperRef.current.decode(message)
      ?? ddjMixerMapperRef.current.decode(message);
    if (!command) return;

    const browserTracks = navigation.libraryTracks.length
      ? navigation.libraryTracks
      : library.tracks;

    if (command.type === 'browser.move') {
      setScreen('library');
      if (!browserTracks.length) {
        ddjBrowserIndexRef.current = 0;
        return;
      }
      ddjBrowserIndexRef.current = Math.max(
        0,
        Math.min(browserTracks.length - 1, ddjBrowserIndexRef.current + command.delta)
      );
      return;
    }

    if (command.type === 'browser.select') {
      setScreen('library');
      return;
    }

    if (command.type === 'browser.load') {
      const track = browserTracks[ddjBrowserIndexRef.current] ?? browserTracks[0];
      if (!track) return;
      player.dualDeck.setMode(true);
      if (player.dualDeck.loadTrack(command.deck, track)) {
        ddjCuePointsRef.current[command.deck] = null;
        ddjSyncActiveRef.current[command.deck] = false;
        renderDdjLedsRef.current?.();
      }
      return;
    }

    if (command.type === 'deck.toggle-play') {
      player.dualDeck.setMode(true);
      const snapshot = player.dualDeck.getSnapshot(command.deck);
      if (!snapshot?.trackId) return;
      if (snapshot.playing) {
        player.dualDeck.pause(command.deck);
        renderDdjLedsRef.current?.();
      } else {
        void player.dualDeck.play(command.deck).finally(() => renderDdjLedsRef.current?.());
      }
      return;
    }

    if (command.type === 'deck.set-cue') {
      player.dualDeck.setMode(true);
      const snapshot = player.dualDeck.getSnapshot(command.deck);
      if (!snapshot?.trackId) return;

      if (snapshot.playing) {
        player.dualDeck.pause(command.deck);
        player.dualDeck.seek(command.deck, ddjCuePointsRef.current[command.deck] ?? 0);
      } else {
        ddjCuePointsRef.current[command.deck] = snapshot.currentTimeSeconds;
      }
      renderDdjLedsRef.current?.();
      return;
    }

    if (command.type === 'deck.set-tempo') {
      player.dualDeck.setMode(true);
      ddjBaseRateRef.current[command.deck] = command.playbackRate;
      ddjSyncActiveRef.current[command.deck] = false;
      player.dualDeck.setPlaybackRate(command.deck, command.playbackRate);
      renderDdjLedsRef.current?.();
      return;
    }

    if (command.type === 'deck.nudge') {
      player.dualDeck.setMode(true);
      const snapshot = player.dualDeck.getSnapshot(command.deck);
      if (!snapshot?.trackId) return;

      ddjSyncActiveRef.current[command.deck] = false;
      if (!snapshot.playing) {
        player.dualDeck.seek(
          command.deck,
          snapshot.currentTimeSeconds + (command.delta * DDJ400_SCRUB_SECONDS)
        );
        renderDdjLedsRef.current?.();
        return;
      }

      const baseRate = ddjBaseRateRef.current[command.deck] || snapshot.playbackRate || 1;
      const nudgedRate = baseRate * (1 + (command.delta * DDJ400_NUDGE_RATE_DELTA));
      player.dualDeck.setPlaybackRate(command.deck, nudgedRate);

      const existingTimer = ddjNudgeTimerRef.current[command.deck];
      if (existingTimer != null) window.clearTimeout(existingTimer);
      ddjNudgeTimerRef.current[command.deck] = window.setTimeout(() => {
        player.dualDeck.setPlaybackRate(command.deck, ddjBaseRateRef.current[command.deck]);
        ddjNudgeTimerRef.current[command.deck] = null;
      }, 80);
      renderDdjLedsRef.current?.();
      return;
    }

    if (command.type === 'deck.sync') {
      player.dualDeck.setMode(true);
      const masterDeck: DjDeckId = command.deck === 'a' ? 'b' : 'a';
      const targetSnapshot = player.dualDeck.getSnapshot(command.deck);
      const masterSnapshot = player.dualDeck.getSnapshot(masterDeck);
      if (!targetSnapshot?.trackId || !masterSnapshot?.trackId) return;

      const targetTrack = library.tracks.find(track => track.id === targetSnapshot.trackId);
      const masterTrack = library.tracks.find(track => track.id === masterSnapshot.trackId);
      const plan = resolveBeatmatchPlan({
        outgoing: masterTrack?.rhythm,
        incoming: targetTrack?.rhythm
      });
      if (!plan) return;

      ddjBaseRateRef.current[command.deck] = plan.playbackRate;
      ddjSyncActiveRef.current = {
        a: command.deck === 'a',
        b: command.deck === 'b'
      };
      player.dualDeck.setPlaybackRate(command.deck, plan.playbackRate);
      renderDdjLedsRef.current?.();
      return;
    }

    if (command.type === 'mixer.set-channel-volume') {
      player.dualDeck.setMode(true);
      player.dualDeck.setVolume(command.deck, command.value);
      scheduleMixerUiSync();
      return;
    }

    if (command.type === 'mixer.set-crossfader') {
      player.dualDeck.setMode(true);
      player.dualDeck.setCrossfader(command.value);
      scheduleMixerUiSync();
    }
  }, [library.tracks, navigation.libraryTracks, player.dualDeck, scheduleMixerUiSync, setScreen]);

  const midiController = useWebMidiController({ onMessage: handleDdj400Message });

  const readDdjLedState = useCallback((): Ddj400LedState => {
    const a = player.dualDeck.getSnapshot('a');
    const b = player.dualDeck.getSnapshot('b');
    return {
      play: {
        a: Boolean(a?.trackId && a.playing),
        b: Boolean(b?.trackId && b.playing)
      },
      cue: {
        a: ddjCuePointsRef.current.a != null,
        b: ddjCuePointsRef.current.b != null
      },
      sync: { ...ddjSyncActiveRef.current }
    };
  }, [player.dualDeck.getSnapshot]);

  const scheduleDdjLedRender = useCallback(() => {
    if (ddjLedFrameRef.current != null) return;
    ddjLedFrameRef.current = window.requestAnimationFrame(() => {
      ddjLedFrameRef.current = null;
      ddjLedRendererRef.current?.render(readDdjLedState());
    });
  }, [readDdjLedState]);
  renderDdjLedsRef.current = scheduleDdjLedRender;

  useEffect(() => {
    ddjLedRendererRef.current = new Ddj400LedRenderer(data => midiController.send(data));
    return () => {
      ddjLedRendererRef.current?.clear();
      ddjLedRendererRef.current = null;
    };
  }, [midiController.send]);

  useEffect(() => {
    const renderer = ddjLedRendererRef.current;
    if (!renderer || midiController.status !== 'connected' || !midiController.selectedOutputId) return;
    renderer.reset();
    scheduleDdjLedRender();
  }, [
    midiController.selectedOutputId,
    midiController.status,
    scheduleDdjLedRender
  ]);

  useEffect(() => {
    scheduleDdjLedRender();
  }, [
    player.current?.id,
    player.playing,
    player.currentTime,
    scheduleDdjLedRender
  ]);

  useEffect(() => {
    if (midiController.status === 'connected') return;
    for (const deck of ['a', 'b'] as const) {
      const timer = ddjNudgeTimerRef.current[deck];
      if (timer != null) window.clearTimeout(timer);
      ddjNudgeTimerRef.current[deck] = null;
      ddjBaseRateRef.current[deck] = 1;
      ddjCuePointsRef.current[deck] = null;
      ddjSyncActiveRef.current[deck] = false;
    }
    player.dualDeck.setMode(false);
    setDjMixerState(player.dualDeck.getMixerSnapshot());
  }, [
    midiController.status,
    player.dualDeck.getMixerSnapshot,
    player.dualDeck.setMode
  ]);

  useEffect(() => () => {
    for (const deck of ['a', 'b'] as const) {
      const timer = ddjNudgeTimerRef.current[deck];
      if (timer != null) window.clearTimeout(timer);
    }
    if (mixerUiFrameRef.current != null) window.cancelAnimationFrame(mixerUiFrameRef.current);
    if (ddjLedFrameRef.current != null) window.cancelAnimationFrame(ddjLedFrameRef.current);
  }, []);

  const qualityProfile = useNetworkQualityProfile(player.streamingMode, player.setStreamingMode);
  useBackgroundPlaybackContinuity({
    audioRef: player.audioRef,
    queue: player.queue,
    currentIndex: player.currentIndex,
    currentTrackId: player.current?.id ?? null,
    repeatMode: player.repeatMode,
    playing: player.playing,
    onNext: player.advanceNaturally
  });
  useNextTrackPreload({
    cancellationRef: cancelPreloadRef,
    queue: player.queue,
    currentIndex: player.currentIndex,
    repeatMode: player.repeatMode,
    streamingMode: player.streamingMode,
    normalizationMode: player.normalizationMode,
    manualPlaybackRevision: player.manualPlaybackRevision,
    playing: player.playing
  });
  const current = player.current;
  const nextDecision = nextTrackDecision(player.queue, player.currentIndex, player.repeatMode, false);
  const nextTrack = nextDecision.type === 'restart'
    ? current
    : nextDecision.type === 'track'
      ? player.queue.find(track => track.id === nextDecision.id)
      : undefined;
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
    setScreen('library');
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

  function removeDownload(trackId: string) {
    run(offline.remove(trackId).catch(error => {
      library.reportError(error);
      throw error;
    }));
  }

  function toggleDownload() {
    if (!current) return;
    if (currentHasIndividualDownload) {
      if (!desktopLayout) {
        setMobileDownloadRemoval({
          id: current.id,
          title: current.title,
          availableViaCollection: currentAvailableViaCollection
        });
        return;
      }

      const message = currentAvailableViaCollection
        ? `Remover o download individual de “${current.title}”? A música continuará disponível porque uma coleção offline também depende dela.`
        : `Remover “${current.title}” dos downloads offline?`;
      if (!window.confirm(message)) return;
      removeDownload(current.id);
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
  const tvRemote = useTvRemoteSession({
    current,
    playing: player.playing,
    currentTime: player.currentTime,
    duration: player.duration,
    shuffle: player.shuffle,
    repeatMode: player.repeatMode,
    crossfadeSeconds: player.crossfadeSeconds,
    onTogglePlay: player.togglePlay,
    onPrevious: player.previous,
    onNext: player.next,
    onSeek: player.seek,
    onToggleShuffle: player.toggleShuffle,
    onCycleRepeat: player.cycleRepeat,
    onSetCrossfadeSeconds: player.setCrossfadeSeconds
  });

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
          nextTrack={nextTrack}
          playing={player.playing}
          currentTime={player.currentTime}
          duration={player.duration}
          volume={player.volume}
          usesSystemVolume={usesSystemVolume}
          onTogglePlay={() => void player.togglePlay()}
          onNext={player.next}
          onSeek={player.seek}
          onVolume={player.setVolume}
          onPlayTrack={player.playTrack}
          onOpenAccount={() => setScreen('account')}
          onOpenRemote={() => { void tvRemote.openPairing(); }}
        />
        <div className="tv-remote-pairing-stack">
          <TvRemoteEntryButton onClick={() => { void tvRemote.openPairing(); }} />
          <TvRemotePairingDialog
            open={tvRemote.open}
            state={tvRemote.state}
            transport={tvRemote.transport}
            pairingUrl={tvRemote.pairingUrl}
            error={tvRemote.error}
            onClose={tvRemote.closePairing}
            onRegenerate={() => { void tvRemote.regenerate(); }}
          />
        </div>
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
              midiController={midiController}
              djMixerState={djMixerState}
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
            nextTrack={nextTrack}
            isDownloaded={currentHasIndividualDownload}
            availableViaCollection={currentAvailableViaCollection}
            downloading={offline.downloadingIds.has(current.id)}
            onTogglePlay={() => void player.togglePlay()}
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
        libraryTab={navigation.libraryTab}
        username={currentUser.username}
        onOpenPlayer={openPlayer}
        onOpenLibrary={() => setScreen('library')}
        onOpenFolders={() => openLibraryTab('folders')}
        onOpenPlaylists={() => openLibraryTab('playlists')}
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

      <MobileSheet
        open={Boolean(mobileDownloadRemoval)}
        title="Remover download"
        onClose={() => setMobileDownloadRemoval(null)}
        className="player-download-confirm-sheet"
      >
        {mobileDownloadRemoval && (
          <div className="mobile-sheet-confirm">
            <p>
              {mobileDownloadRemoval.availableViaCollection
                ? `Remover o download individual de “${mobileDownloadRemoval.title}”? A música continuará disponível porque uma coleção offline também depende dela.`
                : `Remover “${mobileDownloadRemoval.title}” dos downloads offline?`}
            </p>
            <div className="mobile-sheet-confirm__actions">
              <button type="button" onClick={() => setMobileDownloadRemoval(null)}>Cancelar</button>
              <button
                className="is-danger"
                type="button"
                onClick={() => {
                  removeDownload(mobileDownloadRemoval.id);
                  setMobileDownloadRemoval(null);
                }}
              >
                Remover
              </button>
            </div>
          </div>
        )}
      </MobileSheet>

      {library.actionError && (
        <button className="app-toast" role="status" onClick={library.clearActionError}>
          {library.actionError}
        </button>
      )}
    </main>
  );
}