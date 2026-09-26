import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import { DesktopNowPlayingScreen } from './components/DesktopNowPlayingScreen';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopPlayerSidebarTools } from './components/DesktopPlayerSidebarTools';
import { DjModeScreen, type DjDeckPanelState } from './components/DjModeScreen';
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
import {
  effectiveDjAutomixDuration,
  shouldStartDjAutomixTransition
} from './dj-automix-policy';
import { isDjKeyboardEditableTarget, mapDjKeyboardCode } from './dj-keyboard-mapping';
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
import {
  QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS,
  resolveQuantizedCrossfadePlan
} from './beat-clock';
import { resolveBeatmatchPlan } from './beatmatch';
import type { DjDeckId } from './dj-controller-contract';
import { resolveCrossfadeCandidate } from './crossfade';
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
  const [djBrowserIndex, setDjBrowserIndex] = useState(0);
  const [djFolderPath, setDjFolderPath] = useState('');
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
  const [djMixMode, setDjMixMode] = useState<'manual' | 'automix'>('manual');
  const djMixModeRef = useRef<'manual' | 'automix'>('manual');
  const djAutomixActiveDeckRef = useRef<DjDeckId>('a');
  const djAutomixQueueIndexRef = useRef(player.currentIndex);
  const djAutomixFrameRef = useRef<number | null>(null);
  const djAutomixTransitionRef = useRef(false);

  const scheduleMixerUiSync = useCallback(() => {
    if (mixerUiFrameRef.current != null) return;
    mixerUiFrameRef.current = window.requestAnimationFrame(() => {
      mixerUiFrameRef.current = null;
      setDjMixerState(player.dualDeck.getMixerSnapshot());
    });
  }, [player.dualDeck.getMixerSnapshot]);
  const ddjNudgeTimerRef = useRef<Record<DjDeckId, number | null>>({ a: null, b: null });

  const setDjModeState = useCallback((mode: 'manual' | 'automix') => {
    djMixModeRef.current = mode;
    setDjMixMode(mode);
  }, []);

  const cancelDjAutomixTransition = useCallback(() => {
    if (djAutomixFrameRef.current != null) {
      window.cancelAnimationFrame(djAutomixFrameRef.current);
      djAutomixFrameRef.current = null;
    }
    djAutomixTransitionRef.current = false;
  }, []);

  const switchDjToManual = useCallback(() => {
    if (djMixModeRef.current === 'manual') return;
    cancelDjAutomixTransition();
    setDjModeState('manual');
  }, [cancelDjAutomixTransition, setDjModeState]);

  const djFolderOptions = useMemo(() => {
    const paths = new Set<string>(['']);
    for (const track of library.tracks) {
      const parts = track.folderPath.split('/').filter(Boolean);
      for (let index = 1; index <= parts.length; index += 1) {
        paths.add(parts.slice(0, index).join('/'));
      }
    }
    return [...paths]
      .sort((left, right) => left.localeCompare(right, 'pt-BR'))
      .map(path => ({
        path,
        label: path || 'Todas as pastas'
      }));
  }, [library.tracks]);

  const djBrowserTracks = useMemo(() => {
    if (!djFolderPath) return library.tracks;
    const prefix = `${djFolderPath}/`;
    return library.tracks.filter(track => (
      track.folderPath === djFolderPath
      || track.folderPath.startsWith(prefix)
    ));
  }, [djFolderPath, library.tracks]);

  const selectDjFolder = useCallback((path: string) => {
    setDjFolderPath(path);
    ddjBrowserIndexRef.current = 0;
    setDjBrowserIndex(0);
  }, []);

  const selectDjBrowserIndex = useCallback((index: number) => {
    const max = Math.max(0, djBrowserTracks.length - 1);
    const next = Math.max(0, Math.min(max, index));
    ddjBrowserIndexRef.current = next;
    setDjBrowserIndex(next);
  }, [djBrowserTracks.length]);

  const loadDjBrowserTrack = useCallback((deck: DjDeckId) => {
    switchDjToManual();
    const track = djBrowserTracks[ddjBrowserIndexRef.current] ?? djBrowserTracks[0];
    if (!track) return false;
    player.dualDeck.setMode(true);
    if (!player.dualDeck.loadTrack(deck, track)) return false;

    const timer = ddjNudgeTimerRef.current[deck];
    if (timer != null) window.clearTimeout(timer);
    ddjNudgeTimerRef.current[deck] = null;
    ddjBaseRateRef.current[deck] = 1;
    ddjCuePointsRef.current[deck] = null;
    ddjSyncActiveRef.current[deck] = false;
    renderDdjLedsRef.current?.();
    return true;
  }, [djBrowserTracks, player.dualDeck, switchDjToManual]);

  useEffect(() => {
    if (!djBrowserTracks.length) {
      ddjBrowserIndexRef.current = 0;
      setDjBrowserIndex(0);
      return;
    }
    if (ddjBrowserIndexRef.current >= djBrowserTracks.length) {
      const next = djBrowserTracks.length - 1;
      ddjBrowserIndexRef.current = next;
      setDjBrowserIndex(next);
    }
  }, [djBrowserTracks.length]);

  const toggleDjDeckPlay = useCallback((deck: DjDeckId) => {
    switchDjToManual();
    player.dualDeck.setMode(true);
    const snapshot = player.dualDeck.getSnapshot(deck);
    if (!snapshot?.trackId) return;
    if (snapshot.playing) {
      player.dualDeck.pause(deck);
      renderDdjLedsRef.current?.();
      return;
    }
    void player.dualDeck.play(deck).finally(() => renderDdjLedsRef.current?.());
  }, [player.dualDeck, switchDjToManual]);

  const cueDjDeck = useCallback((deck: DjDeckId) => {
    switchDjToManual();
    player.dualDeck.setMode(true);
    const snapshot = player.dualDeck.getSnapshot(deck);
    if (!snapshot?.trackId) return;

    if (snapshot.playing) {
      player.dualDeck.pause(deck);
      player.dualDeck.seek(deck, ddjCuePointsRef.current[deck] ?? 0);
    } else {
      ddjCuePointsRef.current[deck] = snapshot.currentTimeSeconds;
    }
    renderDdjLedsRef.current?.();
  }, [player.dualDeck, switchDjToManual]);

  const setDjChannelVolume = useCallback((deck: DjDeckId, value: number) => {
    switchDjToManual();
    player.dualDeck.setMode(true);
    player.dualDeck.setVolume(deck, value);
    scheduleMixerUiSync();
  }, [player.dualDeck, scheduleMixerUiSync, switchDjToManual]);

  const setDjCrossfader = useCallback((value: number) => {
    switchDjToManual();
    player.dualDeck.setMode(true);
    player.dualDeck.setCrossfader(value);
    scheduleMixerUiSync();
  }, [player.dualDeck, scheduleMixerUiSync, switchDjToManual]);

  const nudgeDjDeck = useCallback((deck: DjDeckId, delta: -1 | 1) => {
    switchDjToManual();
    player.dualDeck.setMode(true);
    const snapshot = player.dualDeck.getSnapshot(deck);
    if (!snapshot?.trackId) return;

    ddjSyncActiveRef.current[deck] = false;
    if (!snapshot.playing) {
      player.dualDeck.seek(
        deck,
        snapshot.currentTimeSeconds + (delta * DDJ400_SCRUB_SECONDS)
      );
      renderDdjLedsRef.current?.();
      return;
    }

    const baseRate = ddjBaseRateRef.current[deck] || snapshot.playbackRate || 1;
    const nudgedRate = baseRate * (1 + (delta * DDJ400_NUDGE_RATE_DELTA));
    player.dualDeck.setPlaybackRate(deck, nudgedRate);

    const existingTimer = ddjNudgeTimerRef.current[deck];
    if (existingTimer != null) window.clearTimeout(existingTimer);
    ddjNudgeTimerRef.current[deck] = window.setTimeout(() => {
      player.dualDeck.setPlaybackRate(deck, ddjBaseRateRef.current[deck]);
      ddjNudgeTimerRef.current[deck] = null;
    }, 80);
    renderDdjLedsRef.current?.();
  }, [player.dualDeck, switchDjToManual]);

  const syncDjDeck = useCallback((deck: DjDeckId) => {
    switchDjToManual();
    player.dualDeck.setMode(true);
    const masterDeck: DjDeckId = deck === 'a' ? 'b' : 'a';
    const targetSnapshot = player.dualDeck.getSnapshot(deck);
    const masterSnapshot = player.dualDeck.getSnapshot(masterDeck);
    if (!targetSnapshot?.trackId || !masterSnapshot?.trackId) return;

    const targetTrack = library.tracks.find(track => track.id === targetSnapshot.trackId);
    const masterTrack = library.tracks.find(track => track.id === masterSnapshot.trackId);
    const plan = resolveBeatmatchPlan({
      outgoing: masterTrack?.rhythm,
      incoming: targetTrack?.rhythm
    });
    if (!plan) return;

    ddjBaseRateRef.current[deck] = plan.playbackRate;
    ddjSyncActiveRef.current = {
      a: deck === 'a',
      b: deck === 'b'
    };
    player.dualDeck.setPlaybackRate(deck, plan.playbackRate);
    renderDdjLedsRef.current?.();
  }, [library.tracks, player.dualDeck, switchDjToManual]);


  const prepareDjAutomixNext = useCallback((activeDeck: DjDeckId, queueIndex: number) => {
    const decision = nextTrackDecision(player.queue, queueIndex, player.repeatMode, true);
    const nextTrack = decision.type === 'restart'
      ? player.queue[queueIndex] ?? null
      : decision.type === 'track'
        ? player.queue.find(track => track.id === decision.id) ?? null
        : null;
    if (!nextTrack) return null;

    const incomingDeck: DjDeckId = activeDeck === 'a' ? 'b' : 'a';
    const incomingSnapshot = player.dualDeck.getSnapshot(incomingDeck);
    if (incomingSnapshot?.trackId !== nextTrack.id) {
      player.dualDeck.loadTrack(incomingDeck, nextTrack);
      ddjBaseRateRef.current[incomingDeck] = 1;
      ddjCuePointsRef.current[incomingDeck] = null;
      ddjSyncActiveRef.current[incomingDeck] = false;
    }
    return nextTrack;
  }, [player.dualDeck, player.queue, player.repeatMode]);

  const startDjAutomixTransition = useCallback((options: {
    activeDeck: DjDeckId;
    currentTrack: (typeof library.tracks)[number];
    nextTrack: (typeof library.tracks)[number];
    nextQueueIndex: number;
    durationSeconds: number;
  }) => {
    if (djAutomixTransitionRef.current || djMixModeRef.current !== 'automix') return;

    const incomingDeck: DjDeckId = options.activeDeck === 'a' ? 'b' : 'a';
    const activeSnapshot = player.dualDeck.getSnapshot(options.activeDeck);
    if (!activeSnapshot?.trackId) return;

    const incomingSnapshot = player.dualDeck.getSnapshot(incomingDeck);
    if (incomingSnapshot?.trackId !== options.nextTrack.id) {
      if (!player.dualDeck.loadTrack(incomingDeck, options.nextTrack)) return;
    }

    const beatmatch = resolveBeatmatchPlan({
      outgoing: options.currentTrack.rhythm,
      incoming: options.nextTrack.rhythm
    });
    if (beatmatch) {
      ddjBaseRateRef.current[incomingDeck] = beatmatch.playbackRate;
      player.dualDeck.setPlaybackRate(incomingDeck, beatmatch.playbackRate);
      if (options.nextTrack.rhythm?.firstBeatSeconds != null) {
        player.dualDeck.seek(incomingDeck, options.nextTrack.rhythm.firstBeatSeconds);
      }
    } else {
      ddjBaseRateRef.current[incomingDeck] = 1;
      player.dualDeck.setPlaybackRate(incomingDeck, 1);
    }

    player.dualDeck.setVolume(options.activeDeck, 1);
    player.dualDeck.setVolume(incomingDeck, 1);
    player.dualDeck.setCrossfader(options.activeDeck === 'a' ? -1 : 1);
    scheduleMixerUiSync();

    djAutomixTransitionRef.current = true;
    void player.dualDeck.play(incomingDeck).then(started => {
      if (!started || djMixModeRef.current !== 'automix') {
        djAutomixTransitionRef.current = false;
        return;
      }

      const startedAt = performance.now();
      const durationMs = Math.max(250, options.durationSeconds * 1000);
      const from = options.activeDeck === 'a' ? -1 : 1;
      const to = -from;

      const animate = (now: number) => {
        if (djMixModeRef.current !== 'automix') {
          djAutomixTransitionRef.current = false;
          djAutomixFrameRef.current = null;
          return;
        }

        const progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
        player.dualDeck.setCrossfader(from + ((to - from) * progress));
        scheduleMixerUiSync();

        if (progress < 1) {
          djAutomixFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        djAutomixFrameRef.current = null;
        player.dualDeck.pause(options.activeDeck);
        player.dualDeck.unload(options.activeDeck);
        player.dualDeck.setPlaybackRate(incomingDeck, 1);
        ddjBaseRateRef.current[incomingDeck] = 1;
        djAutomixActiveDeckRef.current = incomingDeck;
        djAutomixQueueIndexRef.current = options.nextQueueIndex;
        djAutomixTransitionRef.current = false;
        prepareDjAutomixNext(incomingDeck, options.nextQueueIndex);
        renderDdjLedsRef.current?.();
      };

      djAutomixFrameRef.current = window.requestAnimationFrame(animate);
    });
  }, [
    library.tracks,
    player.dualDeck,
    prepareDjAutomixNext,
    scheduleMixerUiSync
  ]);

  const enableDjAutomix = useCallback(() => {
    cancelDjAutomixTransition();
    player.dualDeck.setMode(true);

    const a = player.dualDeck.getSnapshot('a');
    const b = player.dualDeck.getSnapshot('b');
    let activeDeck: DjDeckId = a?.playing ? 'a' : b?.playing ? 'b' : a?.trackId ? 'a' : b?.trackId ? 'b' : 'a';
    let activeSnapshot = player.dualDeck.getSnapshot(activeDeck);

    if (!activeSnapshot?.trackId && player.current) {
      if (!player.dualDeck.loadTrack(activeDeck, player.current)) return;
      player.dualDeck.seek(activeDeck, player.currentTime);
      activeSnapshot = player.dualDeck.getSnapshot(activeDeck);
    }
    if (!activeSnapshot?.trackId) return;

    const queueIndex = player.queue.findIndex(track => track.id === activeSnapshot?.trackId);
    djAutomixQueueIndexRef.current = queueIndex >= 0 ? queueIndex : Math.max(0, player.currentIndex);
    djAutomixActiveDeckRef.current = activeDeck;
    player.dualDeck.setVolume('a', 1);
    player.dualDeck.setVolume('b', 1);
    player.dualDeck.setCrossfader(activeDeck === 'a' ? -1 : 1);
    scheduleMixerUiSync();
    setDjModeState('automix');
    prepareDjAutomixNext(activeDeck, djAutomixQueueIndexRef.current);

    const latest = player.dualDeck.getSnapshot(activeDeck);
    if (latest?.trackId && !latest.playing) {
      void player.dualDeck.play(activeDeck).finally(() => renderDdjLedsRef.current?.());
    }
  }, [
    cancelDjAutomixTransition,
    player.current,
    player.currentIndex,
    player.currentTime,
    player.dualDeck,
    player.queue,
    prepareDjAutomixNext,
    scheduleMixerUiSync,
    setDjModeState
  ]);

  const disableDjAutomix = useCallback(() => {
    cancelDjAutomixTransition();
    setDjModeState('manual');
  }, [cancelDjAutomixTransition, setDjModeState]);

  useEffect(() => {
    if (screen !== 'dj' || djMixMode !== 'automix') return;

    let frame: number | null = null;
    let lastCheck = 0;

    const check = (timestamp: number) => {
      if (timestamp - lastCheck >= 100 && !djAutomixTransitionRef.current) {
        lastCheck = timestamp;
        const activeDeck = djAutomixActiveDeckRef.current;
        const snapshot = player.dualDeck.getSnapshot(activeDeck);
        if (snapshot?.trackId && snapshot.playing && snapshot.durationSeconds > 0) {
          const currentTrack = library.tracks.find(track => track.id === snapshot.trackId);
          if (currentTrack) {
            const remainingSeconds = Math.max(0, snapshot.durationSeconds - snapshot.currentTimeSeconds);
            const quantized = resolveQuantizedCrossfadePlan({
              rhythm: currentTrack.rhythm,
              trackDurationSeconds: snapshot.durationSeconds,
              preferredDurationSeconds: player.crossfadeSeconds
            });
            const shouldStart = shouldStartDjAutomixTransition({
              currentTimeSeconds: snapshot.currentTimeSeconds,
              durationSeconds: snapshot.durationSeconds,
              crossfadeSeconds: player.crossfadeSeconds,
              quantizedStartTimeSeconds: quantized?.startTimeSeconds,
              earlyToleranceSeconds: QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS
            });

            if (shouldStart) {
              const candidate = resolveCrossfadeCandidate({
                queue: player.queue,
                currentIndex: djAutomixQueueIndexRef.current,
                currentTrackId: snapshot.trackId,
                repeatMode: player.repeatMode,
                durationSeconds: quantized?.durationSeconds ?? player.crossfadeSeconds,
                visibilityState: document.visibilityState,
                remainingSeconds
              });
              const fallbackDecision = nextTrackDecision(
                player.queue,
                djAutomixQueueIndexRef.current,
                player.repeatMode,
                true
              );
              const fallbackTrack = fallbackDecision.type === 'restart'
                ? currentTrack
                : fallbackDecision.type === 'track'
                  ? player.queue.find(track => track.id === fallbackDecision.id) ?? null
                  : null;
              const nextTrack = candidate
                ? player.queue.find(track => track.id === candidate.trackId) ?? null
                : fallbackTrack;
              const nextQueueIndex = nextTrack
                ? player.queue.findIndex(track => track.id === nextTrack.id)
                : -1;
              if (nextTrack && nextQueueIndex >= 0) {
                startDjAutomixTransition({
                  activeDeck,
                  currentTrack,
                  nextTrack,
                  nextQueueIndex,
                  durationSeconds: effectiveDjAutomixDuration(
                    candidate?.durationSeconds ?? player.crossfadeSeconds
                  )
                });
              }
            }
          }
        }
      }
      frame = window.requestAnimationFrame(check);
    };

    frame = window.requestAnimationFrame(check);
    return () => {
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [
    djMixMode,
    library.tracks,
    player.crossfadeSeconds,
    player.dualDeck.getSnapshot,
    player.queue,
    player.repeatMode,
    screen,
    startDjAutomixTransition
  ]);

  const readDjDeckPanel = useCallback((deck: DjDeckId): DjDeckPanelState => {
    const snapshot = player.dualDeck.getSnapshot(deck);
    const mixer = player.dualDeck.getMixerSnapshot();
    return {
      snapshot,
      track: snapshot?.trackId
        ? library.tracks.find(track => track.id === snapshot.trackId) ?? null
        : null,
      cuePointSeconds: ddjCuePointsRef.current[deck],
      syncActive: ddjSyncActiveRef.current[deck],
      channelVolume: mixer.channelVolumes[deck]
    };
  }, [library.tracks, player.dualDeck.getMixerSnapshot, player.dualDeck.getSnapshot]);

  const [djDeckPanels, setDjDeckPanels] = useState<Record<DjDeckId, DjDeckPanelState>>(() => ({
    a: readDjDeckPanel('a'),
    b: readDjDeckPanel('b')
  }));

  useEffect(() => {
    if (screen !== 'dj') return;
    let frame: number | null = null;
    let lastUpdate = 0;

    const syncPanels = (timestamp: number) => {
      if (timestamp - lastUpdate >= 100 || lastUpdate === 0) {
        lastUpdate = timestamp;
        setDjDeckPanels({
          a: readDjDeckPanel('a'),
          b: readDjDeckPanel('b')
        });
        setDjMixerState(player.dualDeck.getMixerSnapshot());
      }
      frame = window.requestAnimationFrame(syncPanels);
    };

    frame = window.requestAnimationFrame(syncPanels);
    return () => {
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [player.dualDeck.getMixerSnapshot, readDjDeckPanel, screen]);

  const handleDdj400Message = useCallback((message: Parameters<typeof decodeDdj400Message>[0]) => {
    const command = decodeDdj400Message(message)
      ?? ddjPerformanceMapperRef.current.decode(message)
      ?? ddjMixerMapperRef.current.decode(message);
    if (!command) return;

    const browserTracks = djBrowserTracks;

    if (command.type === 'browser.move') {
      if (!browserTracks.length) {
        selectDjBrowserIndex(0);
        return;
      }
      selectDjBrowserIndex(ddjBrowserIndexRef.current + command.delta);
      if (screen !== 'dj') setScreen('library');
      return;
    }

    if (command.type === 'browser.select') {
      if (screen !== 'dj') setScreen('library');
      return;
    }

    if (command.type === 'browser.load') {
      loadDjBrowserTrack(command.deck);
      return;
    }

    if (command.type === 'deck.toggle-play') {
      toggleDjDeckPlay(command.deck);
      return;
    }

    if (command.type === 'deck.set-cue') {
      cueDjDeck(command.deck);
      return;
    }

    if (command.type === 'deck.set-tempo') {
      switchDjToManual();
      player.dualDeck.setMode(true);
      ddjBaseRateRef.current[command.deck] = command.playbackRate;
      ddjSyncActiveRef.current[command.deck] = false;
      player.dualDeck.setPlaybackRate(command.deck, command.playbackRate);
      renderDdjLedsRef.current?.();
      return;
    }

    if (command.type === 'deck.nudge') {
      const direction = command.delta < 0 ? -1 : command.delta > 0 ? 1 : 0;
      if (direction === 0) return;
      nudgeDjDeck(command.deck, direction);
      return;
    }

    if (command.type === 'deck.sync') {
      syncDjDeck(command.deck);
      return;
    }

    if (command.type === 'mixer.set-channel-volume') {
      switchDjToManual();
      player.dualDeck.setMode(true);
      player.dualDeck.setVolume(command.deck, command.value);
      scheduleMixerUiSync();
      return;
    }

    if (command.type === 'mixer.set-crossfader') {
      switchDjToManual();
      player.dualDeck.setMode(true);
      player.dualDeck.setCrossfader(command.value);
      scheduleMixerUiSync();
    }
  }, [cueDjDeck, djBrowserTracks, loadDjBrowserTrack, nudgeDjDeck, player.dualDeck, scheduleMixerUiSync, screen, selectDjBrowserIndex, setScreen, switchDjToManual, syncDjDeck, toggleDjDeckPlay]);

  useEffect(() => {
    if (screen !== 'dj') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isDjKeyboardEditableTarget(event.target)) return;
      const command = mapDjKeyboardCode(event.code);
      if (!command || (event.repeat && !command.repeatable)) return;

      event.preventDefault();

      if (command.type === 'deck.toggle-play') {
        toggleDjDeckPlay(command.deck);
        return;
      }
      if (command.type === 'deck.cue') {
        cueDjDeck(command.deck);
        return;
      }
      if (command.type === 'deck.sync') {
        syncDjDeck(command.deck);
        return;
      }
      if (command.type === 'browser.move') {
        selectDjBrowserIndex(ddjBrowserIndexRef.current + command.delta);
        return;
      }
      if (command.type === 'browser.load') {
        loadDjBrowserTrack(command.deck);
        return;
      }
      if (command.type === 'deck.nudge') {
        nudgeDjDeck(command.deck, command.delta);
        return;
      }
      if (command.type === 'mixer.channel') {
        const mixer = player.dualDeck.getMixerSnapshot();
        setDjChannelVolume(
          command.deck,
          mixer.channelVolumes[command.deck] + (command.delta * 0.05)
        );
        return;
      }

      const mixer = player.dualDeck.getMixerSnapshot();
      setDjCrossfader(mixer.crossfader + (command.delta * 0.1));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cueDjDeck,
    loadDjBrowserTrack,
    nudgeDjDeck,
    player.dualDeck.getMixerSnapshot,
    screen,
    selectDjBrowserIndex,
    setDjChannelVolume,
    setDjCrossfader,
    syncDjDeck,
    toggleDjDeckPlay
  ]);

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
    scheduleDdjLedRender
  ]);

  const disconnectMidiController = useCallback(() => {
    ddjLedRendererRef.current?.clear();
    midiController.disconnect();
  }, [midiController.disconnect]);

  const selectMidiOutput = useCallback((id: string | null) => {
    if (id !== midiController.selectedOutputId) ddjLedRendererRef.current?.clear();
    const selected = midiController.selectOutput(id);
    if (selected) {
      ddjLedRendererRef.current?.reset();
      scheduleDdjLedRender();
    }
    return selected;
  }, [
    midiController.selectOutput,
    midiController.selectedOutputId,
    scheduleDdjLedRender
  ]);

  useEffect(() => {
    if (midiController.status === 'connected') return;
    for (const deck of ['a', 'b'] as const) {
      const timer = ddjNudgeTimerRef.current[deck];
      if (timer != null) window.clearTimeout(timer);
      ddjNudgeTimerRef.current[deck] = null;
      const snapshot = player.dualDeck.getSnapshot(deck);
      if (snapshot?.trackId) {
        player.dualDeck.setPlaybackRate(deck, ddjBaseRateRef.current[deck] || 1);
      }
    }
  }, [
    midiController.status,
    player.dualDeck.getSnapshot,
    player.dualDeck.setPlaybackRate
  ]);

  useEffect(() => () => {
    for (const deck of ['a', 'b'] as const) {
      const timer = ddjNudgeTimerRef.current[deck];
      if (timer != null) window.clearTimeout(timer);
    }
    if (mixerUiFrameRef.current != null) window.cancelAnimationFrame(mixerUiFrameRef.current);
    if (ddjLedFrameRef.current != null) window.cancelAnimationFrame(ddjLedFrameRef.current);
    if (djAutomixFrameRef.current != null) window.cancelAnimationFrame(djAutomixFrameRef.current);
  }, []);

  useEffect(() => {
    if (screen === 'dj') {
      if (!player.hydrated) return;
      if (!player.djSession.active()) player.djSession.enter();
      return;
    }
    if (djMixModeRef.current === 'automix') disableDjAutomix();
    if (player.djSession.active()) player.djSession.exit();
  }, [disableDjAutomix, player.djSession.enter, player.djSession.exit, player.hydrated, screen]);

  const qualityProfile = useNetworkQualityProfile(player.streamingMode, player.setStreamingMode);
  useBackgroundPlaybackContinuity({
    audioRef: player.audioRef,
    queue: player.queue,
    currentIndex: player.currentIndex,
    currentTrackId: player.current?.id ?? null,
    repeatMode: player.repeatMode,
    playing: screen === 'dj' ? false : player.playing,
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
    playing: screen === 'dj' ? false : player.playing
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

  function openDjMode() {
    player.djSession.enter();
    setScreen('dj');
  }

  function closeDjMode() {
    player.djSession.exit();
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

  if (screen === 'dj') {
    return (
      <main className="app-shell app-shell--dj">
        {audioDecks}
        <DjModeScreen
          decks={djDeckPanels}
          mixer={djMixerState}
          libraryTracks={djBrowserTracks}
          libraryFolders={djFolderOptions}
          selectedFolderPath={djFolderPath}
          onSelectFolderPath={selectDjFolder}
          selectedLibraryIndex={djBrowserIndex}
          onSelectLibraryIndex={selectDjBrowserIndex}
          onLoadSelectedTrack={loadDjBrowserTrack}
          midi={midiController}
          onDisconnectMidi={disconnectMidiController}
          onSelectMidiOutput={selectMidiOutput}
          onChannelVolume={setDjChannelVolume}
          onCrossfader={setDjCrossfader}
          onTogglePlay={toggleDjDeckPlay}
          onCue={cueDjDeck}
          onSync={syncDjDeck}
          mixMode={djMixMode}
          onMixModeChange={mode => {
            if (mode === 'automix') enableDjAutomix();
            else disableDjAutomix();
          }}
          onExit={closeDjMode}
        />
        {library.actionError && (
          <button className="app-toast" role="status" onClick={library.clearActionError}>
            {library.actionError}
          </button>
        )}
      </main>
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
        onOpenDjMode={desktopLayout ? openDjMode : undefined}
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
              midiController={{
                ...midiController,
                disconnect: disconnectMidiController,
                selectOutput: selectMidiOutput
              }}
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