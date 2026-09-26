import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NormalizationMode, Track } from '@home-music/shared';
import { isAppleMobileWebKit } from './background-playback';
import {
  QUANTIZED_CROSSFADE_ARM_SECONDS,
  QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS,
  quantizedCrossfadeWakeDelayMs,
  resolveQuantizedCrossfadePlan
} from './beat-clock';
import {
  BEATMATCH_RATE_RESTORE_SECONDS,
  canPhaseAlignBeatmatch,
  interpolatePlaybackRate,
  resolveBeatmatchPlan
} from './beatmatch';
import {
  isCrossfadeCompletionPause,
  normalizeCrossfadeSeconds,
  otherCrossfadeDeck,
  readCrossfadeSeconds,
  resolveCrossfadeCandidate,
  resolveCrossfadePreloadTrackId,
  writeCrossfadeSeconds,
  type CrossfadeCandidate,
  type CrossfadeDeck
} from './crossfade';
import {
  clearCrossfadeVisualState,
  setCrossfadeVisualState,
  syncCrossfadeVisualElapsed
} from './crossfade-visual';
import { offlineAudioUrl } from './offline-downloads';
import { resolveOutputVolume } from './player-state';
import {
  effectiveNormalizationMode,
  onlineAudioUrl,
  type StreamingMode
} from './streaming-quality';
import { getTvRemoteMediaSource } from './tv-remote-media-source';
import {
  clearDeckAudio,
  loadDeckAudio,
  pauseDeckAudio,
  playDeckAudio,
  readDeckAudioSnapshot,
  seekDeckAudio,
  setDeckPlaybackRate,
  setDeckVolume
} from './dual-deck-audio';
import type { DjDeckId } from './dj-controller-contract';
import {
  createNormalPlaybackSessionSnapshot,
  type NormalPlaybackSessionSnapshot
} from './dj-session-policy';
import {
  createDefaultDualDeckMixerState,
  resolveDualDeckOutputGain
} from './dual-deck-mixer';
import { useAudioPlayer } from './useAudioPlayer';

function initialCrossfadeSeconds() {
  try {
    return readCrossfadeSeconds(window.localStorage);
  } catch {
    return 0;
  }
}

function persistCrossfadeSeconds(seconds: number) {
  try {
    writeCrossfadeSeconds(window.localStorage, seconds);
  } catch {
    // Preferência local e best-effort; playback não depende da persistência.
  }
}

type CrossfadeAudioPlayerOptions = {
  offlineMode?: boolean;
  beforeManualPlaybackChange?: () => void;
};

export function useCrossfadeAudioPlayer(
  tracks: Track[],
  progressVisible: boolean,
  libraryReady: boolean,
  usesSystemVolume: boolean,
  options: CrossfadeAudioPlayerOptions = {}
) {
  const offlineMode = Boolean(options.offlineMode);
  const cancelRef = useRef<(() => void) | null>(null);
  const externalCancelRef = useRef(options.beforeManualPlaybackChange);
  externalCancelRef.current = options.beforeManualPlaybackChange;
  const beforeManualPlaybackChange = useCallback(() => {
    cancelRef.current?.();
    externalCancelRef.current?.();
  }, []);
  const player = useAudioPlayer(tracks, progressVisible, libraryReady, usesSystemVolume, { ...options, beforeManualPlaybackChange });
  const deckARef = useRef<HTMLAudioElement>(null);
  const deckBRef = useRef<HTMLAudioElement>(null);
  const activeDeckRef = useRef<CrossfadeDeck>('a');
  const dualDeckModeRef = useRef(false);
  const dualDeckMixerRef = useRef(createDefaultDualDeckMixerState());
  const normalSessionRef = useRef<NormalPlaybackSessionSnapshot | null>(null);
  const deckTrackIdsRef = useRef<Record<DjDeckId, string | null>>({
    a: player.current?.id ?? null,
    b: null
  });
  const animationFrameRef = useRef<number | null>(null);
  const quantizedScheduleFrameRef = useRef<number | null>(null);
  const quantizedWakeTimeoutRef = useRef<number | null>(null);
  const playbackRateRestoreFrameRef = useRef<number | null>(null);
  const preparedIncomingTrackIdRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const originTrackIdRef = useRef<string | null>(null);
  const startingTrackIdRef = useRef<string | null>(null);
  const incomingTrackIdRef = useRef<string | null>(null);
  const currentTrackIdRef = useRef<string | null>(player.current?.id ?? null);
  const outputVolumeRef = useRef(resolveOutputVolume(player.volume, usesSystemVolume));
  const [crossfadeSeconds, setCrossfadeSecondsState] = useState(initialCrossfadeSeconds);

  currentTrackIdRef.current = player.current?.id ?? null;
  outputVolumeRef.current = resolveOutputVolume(player.volume, usesSystemVolume);
  if (!dualDeckModeRef.current) {
    deckTrackIdsRef.current[activeDeckRef.current] = player.current?.id ?? null;
  }

  const getDeckAudio = useCallback((deck: CrossfadeDeck) => (
    deck === 'a' ? deckARef.current : deckBRef.current
  ), []);

  const getActiveAudio = useCallback(() => getDeckAudio(activeDeckRef.current), [getDeckAudio]);

  const getInactiveAudio = useCallback(() => (
    getDeckAudio(otherCrossfadeDeck(activeDeckRef.current))
  ), [getDeckAudio]);

  const applyDualDeckMixer = useCallback(() => {
    const mixer = dualDeckMixerRef.current;
    for (const deck of ['a', 'b'] as const) {
      const audio = getDeckAudio(deck);
      if (!audio) continue;
      setDeckVolume(audio, resolveDualDeckOutputGain({
        deck,
        masterVolume: outputVolumeRef.current,
        channelVolume: mixer.channelVolumes[deck],
        crossfader: mixer.crossfader
      }));
    }
  }, [getDeckAudio]);

  useEffect(() => {
    if (dualDeckModeRef.current) applyDualDeckMixer();
  }, [applyDualDeckMixer, player.volume, usesSystemVolume]);

  const clearAudio = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) return;
    clearDeckAudio(audio);
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current == null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const cancelQuantizedSchedule = useCallback(() => {
    if (quantizedScheduleFrameRef.current == null) return;
    window.cancelAnimationFrame(quantizedScheduleFrameRef.current);
    quantizedScheduleFrameRef.current = null;
  }, []);

  const cancelQuantizedWake = useCallback(() => {
    if (quantizedWakeTimeoutRef.current == null) return;
    window.clearTimeout(quantizedWakeTimeoutRef.current);
    quantizedWakeTimeoutRef.current = null;
  }, []);

  const cancelPlaybackRateRestore = useCallback(() => {
    if (playbackRateRestoreFrameRef.current == null) return;
    window.cancelAnimationFrame(playbackRateRestoreFrameRef.current);
    playbackRateRestoreFrameRef.current = null;
  }, []);

  const restorePlaybackRate = useCallback((audio: HTMLAudioElement) => {
    cancelPlaybackRateRestore();
    const initialRate = audio.playbackRate;
    if (!Number.isFinite(initialRate) || Math.abs(initialRate - 1) < 1e-4) {
      audio.playbackRate = 1;
      return;
    }

    const startedAt = performance.now();
    const restore = (now: number) => {
      if (audio !== getActiveAudio() || audio.paused || audio.ended) {
        audio.playbackRate = 1;
        playbackRateRestoreFrameRef.current = null;
        return;
      }

      const elapsedSeconds = Math.max(0, (now - startedAt) / 1_000);
      audio.playbackRate = interpolatePlaybackRate(
        initialRate,
        elapsedSeconds,
        BEATMATCH_RATE_RESTORE_SECONDS
      );
      if (elapsedSeconds >= BEATMATCH_RATE_RESTORE_SECONDS) {
        audio.playbackRate = 1;
        playbackRateRestoreFrameRef.current = null;
        return;
      }

      playbackRateRestoreFrameRef.current = window.requestAnimationFrame(restore);
    };

    playbackRateRestoreFrameRef.current = window.requestAnimationFrame(restore);
  }, [cancelPlaybackRateRestore, getActiveAudio]);

  const cancelCrossfade = useCallback(() => {
    attemptRef.current += 1;
    cancelAnimation();
    cancelQuantizedSchedule();
    cancelQuantizedWake();
    cancelPlaybackRateRestore();
    preparedIncomingTrackIdRef.current = null;
    originTrackIdRef.current = null;
    startingTrackIdRef.current = null;
    incomingTrackIdRef.current = null;
    clearCrossfadeVisualState();

    const activeAudio = getActiveAudio();
    const inactiveAudio = getInactiveAudio();
    if (activeAudio) {
      player.audioRef.current = activeAudio;
      if (!dualDeckModeRef.current) {
        activeAudio.volume = outputVolumeRef.current;
        activeAudio.playbackRate = 1;
      }
    }
    if (dualDeckModeRef.current) applyDualDeckMixer();
    if (
      !dualDeckModeRef.current
      && inactiveAudio
      && inactiveAudio !== activeAudio
    ) {
      const inactiveDeck = otherCrossfadeDeck(activeDeckRef.current);
      clearAudio(inactiveAudio);
      deckTrackIdsRef.current[inactiveDeck] = null;
    }
  }, [applyDualDeckMixer, cancelAnimation, cancelPlaybackRateRestore, cancelQuantizedSchedule, cancelQuantizedWake, clearAudio, getActiveAudio, getInactiveAudio, player.audioRef]);

  useLayoutEffect(() => {
    cancelRef.current = cancelCrossfade;
    return () => { cancelRef.current = null; };
  }, [cancelCrossfade]);

  useLayoutEffect(() => {
    const initialAudio = deckARef.current;
    if (!initialAudio) return;
    activeDeckRef.current = 'a';
    player.audioRef.current = initialAudio;

    return () => {
      player.audioRef.current = null;
    };
  }, [player.audioRef]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') cancelCrossfade();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cancelCrossfade]);

  useEffect(() => {
    const currentTrackId = player.current?.id ?? null;
    const originTrackId = originTrackIdRef.current;
    if (originTrackId && originTrackId !== currentTrackId) cancelCrossfade();
  }, [cancelCrossfade, player.current?.id]);

  useEffect(() => {
    if (
      !player.playing
      && (
        startingTrackIdRef.current
        || incomingTrackIdRef.current
        || quantizedScheduleFrameRef.current != null
        || quantizedWakeTimeoutRef.current != null
      )
    ) {
      cancelCrossfade();
    }
  }, [cancelCrossfade, player.playing]);

  useEffect(() => () => {
    attemptRef.current += 1;
    cancelAnimation();
    cancelQuantizedSchedule();
    cancelQuantizedWake();
    cancelPlaybackRateRestore();
    clearCrossfadeVisualState();
    clearAudio(deckARef.current);
    clearAudio(deckBRef.current);
  }, [cancelAnimation, cancelPlaybackRateRestore, cancelQuantizedSchedule, cancelQuantizedWake, clearAudio]);

  const setCrossfadeSeconds = useCallback((seconds: number) => {
    const normalizedSeconds = normalizeCrossfadeSeconds(seconds);
    cancelCrossfade();
    persistCrossfadeSeconds(normalizedSeconds);
    setCrossfadeSecondsState(normalizedSeconds);
  }, [cancelCrossfade]);

  const incomingTrackSource = useCallback((track: Track) => (
    getTvRemoteMediaSource(track.id) ?? (offlineMode
      ? offlineAudioUrl(track.id)
      : onlineAudioUrl(
          track.id,
          player.streamingMode,
          false,
          effectiveNormalizationMode(track, player.normalizationMode)
        ))
  ), [offlineMode, player.normalizationMode, player.streamingMode]);

  const prepareIncomingAudio = useCallback((track: Track) => {
    const incomingDeck = otherCrossfadeDeck(activeDeckRef.current);
    const incomingAudio = getInactiveAudio();
    if (!incomingAudio) return null;
    if (
      preparedIncomingTrackIdRef.current === track.id
      && incomingAudio.getAttribute('src')
    ) return incomingAudio;

    clearAudio(incomingAudio);
    loadDeckAudio(incomingAudio, incomingTrackSource(track), { volume: 0 });
    deckTrackIdsRef.current[incomingDeck] = track.id;
    preparedIncomingTrackIdRef.current = track.id;
    return incomingAudio;
  }, [clearAudio, getInactiveAudio, incomingTrackSource]);

  const startCrossfade = useCallback((
    activeAudio: HTMLAudioElement,
    candidate: CrossfadeCandidate
  ) => {
    if (activeAudio !== getActiveAudio()) return;
    if (!player.playing || activeAudio.paused || activeAudio.ended) return;
    if (startingTrackIdRef.current || incomingTrackIdRef.current) return;

    cancelQuantizedSchedule();
    cancelQuantizedWake();

    const nextTrack = player.queue.find(track => track.id === candidate.trackId);
    const originTrackId = player.current?.id ?? null;
    if (!nextTrack || !originTrackId) return;

    const incomingAudio = prepareIncomingAudio(nextTrack);
    if (!incomingAudio) return;

    const beatmatchPlan = resolveBeatmatchPlan({
      outgoing: player.current?.rhythm,
      incoming: nextTrack.rhythm
    });
    const shouldBeatmatch = Boolean(
      beatmatchPlan
      && canPhaseAlignBeatmatch(beatmatchPlan)
      && nextTrack.rhythm
      && incomingAudio.readyState >= 1
    );

    incomingAudio.playbackRate = 1;
    incomingAudio.preservesPitch = true;
    if (shouldBeatmatch && beatmatchPlan && nextTrack.rhythm) {
      try {
        incomingAudio.playbackRate = beatmatchPlan.playbackRate;
        incomingAudio.currentTime = nextTrack.rhythm.firstBeatSeconds;
      } catch {
        incomingAudio.playbackRate = 1;
        try {
          incomingAudio.currentTime = 0;
        } catch {
          // O deck continua no ponto aceito pelo browser; o handoff ainda é seguro.
        }
      }
    }
    preparedIncomingTrackIdRef.current = null;

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    originTrackIdRef.current = originTrackId;
    startingTrackIdRef.current = candidate.trackId;
    incomingTrackIdRef.current = null;

    void incomingAudio.play()
      .then(() => {
        if (attemptRef.current !== attempt) return;
        if (
          currentTrackIdRef.current !== originTrackId
          || document.visibilityState !== 'visible'
          || getActiveAudio() !== activeAudio
        ) {
          cancelCrossfade();
          return;
        }

        startingTrackIdRef.current = null;
        incomingTrackIdRef.current = candidate.trackId;
        setCrossfadeVisualState({
          attempt,
          originTrackId,
          incomingTrack: nextTrack,
          durationSeconds: candidate.durationSeconds,
          elapsedSeconds: 0
        });

        const animate = () => {
          if (attemptRef.current !== attempt) return;
          if (activeAudio.ended) {
            animationFrameRef.current = null;
            return;
          }
          if (
            document.visibilityState !== 'visible'
            || activeAudio.paused
            || incomingAudio.paused
            || incomingAudio.ended
            || incomingAudio.error
          ) {
            cancelCrossfade();
            return;
          }

          const remainingSeconds = Number.isFinite(activeAudio.duration)
            ? activeAudio.duration - activeAudio.currentTime
            : candidate.durationSeconds;
          if (remainingSeconds > candidate.durationSeconds + 0.75) {
            cancelCrossfade();
            return;
          }

          const elapsedSeconds = Math.max(
            0,
            Math.min(candidate.durationSeconds, candidate.durationSeconds - remainingSeconds)
          );
          const progress = Math.max(
            0,
            Math.min(1, elapsedSeconds / candidate.durationSeconds)
          );
          syncCrossfadeVisualElapsed(attempt, elapsedSeconds);
          const outputVolume = outputVolumeRef.current;
          const angle = progress * Math.PI * 0.5;
          activeAudio.volume = outputVolume * Math.cos(angle);
          incomingAudio.volume = outputVolume * Math.sin(angle);
          animationFrameRef.current = window.requestAnimationFrame(animate);
        };

        animationFrameRef.current = window.requestAnimationFrame(animate);
      })
      .catch(() => {
        if (attemptRef.current === attempt) cancelCrossfade();
      });
  }, [
    cancelCrossfade,
    cancelQuantizedSchedule,
    cancelQuantizedWake,
    getActiveAudio,
    player.current?.id,
    player.current?.rhythm,
    player.playing,
    player.queue,
    prepareIncomingAudio
  ]);

  const maybeStartCrossfade = useCallback((activeAudio: HTMLAudioElement) => {
    if (dualDeckModeRef.current) return;
    if (isAppleMobileWebKit(navigator)) return;
    if (activeAudio !== getActiveAudio()) return;
    if (!player.playing || activeAudio.paused || activeAudio.ended) return;
    if (startingTrackIdRef.current || incomingTrackIdRef.current) return;
    if (!Number.isFinite(activeAudio.duration) || activeAudio.duration <= 0) return;

    const remainingSeconds = Math.max(0, activeAudio.duration - activeAudio.currentTime);
    const quantizedPlan = resolveQuantizedCrossfadePlan({
      rhythm: player.current?.rhythm,
      trackDurationSeconds: activeAudio.duration,
      preferredDurationSeconds: crossfadeSeconds
    });

    if (!quantizedPlan) {
      cancelQuantizedSchedule();
      cancelQuantizedWake();
      const candidate = resolveCrossfadeCandidate({
        queue: player.queue,
        currentIndex: player.currentIndex,
        currentTrackId: player.current?.id ?? null,
        repeatMode: player.repeatMode,
        durationSeconds: crossfadeSeconds,
        visibilityState: document.visibilityState,
        remainingSeconds
      });
      if (candidate) startCrossfade(activeAudio, candidate);
      return;
    }

    const preloadTrackId = resolveCrossfadePreloadTrackId({
      queue: player.queue,
      currentIndex: player.currentIndex,
      currentTrackId: player.current?.id ?? null,
      repeatMode: player.repeatMode,
      visibilityState: document.visibilityState
    });
    const preloadTrack = preloadTrackId
      ? player.queue.find(track => track.id === preloadTrackId)
      : undefined;
    if (preloadTrack) prepareIncomingAudio(preloadTrack);

    const timeUntilStart = quantizedPlan.startTimeSeconds - activeAudio.currentTime;
    if (timeUntilStart > QUANTIZED_CROSSFADE_ARM_SECONDS) {
      cancelQuantizedSchedule();
      if (quantizedWakeTimeoutRef.current == null) {
        const scheduledAttempt = attemptRef.current;
        const scheduledTrackId = player.current?.id ?? null;
        const delayMs = quantizedCrossfadeWakeDelayMs(timeUntilStart);
        quantizedWakeTimeoutRef.current = window.setTimeout(() => {
          quantizedWakeTimeoutRef.current = null;
          if (attemptRef.current !== scheduledAttempt) return;

          const latestAudio = getActiveAudio();
          if (
            !latestAudio
            || latestAudio !== activeAudio
            || currentTrackIdRef.current !== scheduledTrackId
            || document.visibilityState !== 'visible'
            || latestAudio.paused
            || latestAudio.ended
          ) return;

          maybeStartCrossfade(latestAudio);
        }, delayMs);
      }
      return;
    }

    cancelQuantizedWake();

    const resolveQuantizedCandidate = (audio: HTMLAudioElement) => {
      const latestRemainingSeconds = Math.max(0, audio.duration - audio.currentTime);
      const effectiveDurationSeconds = Math.max(
        0,
        Math.min(quantizedPlan.durationSeconds, latestRemainingSeconds)
      );
      return resolveCrossfadeCandidate({
        queue: player.queue,
        currentIndex: player.currentIndex,
        currentTrackId: player.current?.id ?? null,
        repeatMode: player.repeatMode,
        durationSeconds: effectiveDurationSeconds,
        visibilityState: document.visibilityState,
        remainingSeconds: Math.min(latestRemainingSeconds, effectiveDurationSeconds)
      });
    };

    if (timeUntilStart <= QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS) {
      cancelQuantizedSchedule();
      const candidate = resolveQuantizedCandidate(activeAudio);
      if (candidate) startCrossfade(activeAudio, candidate);
      return;
    }

    if (quantizedScheduleFrameRef.current != null) return;

    const scheduledAttempt = attemptRef.current;
    const scheduledTrackId = player.current?.id ?? null;
    const watchBeatBoundary = () => {
      if (attemptRef.current !== scheduledAttempt) {
        quantizedScheduleFrameRef.current = null;
        return;
      }

      const latestAudio = getActiveAudio();
      if (
        !latestAudio
        || latestAudio !== activeAudio
        || currentTrackIdRef.current !== scheduledTrackId
        || document.visibilityState !== 'visible'
        || latestAudio.paused
        || latestAudio.ended
      ) {
        quantizedScheduleFrameRef.current = null;
        return;
      }

      if (
        quantizedPlan.startTimeSeconds - latestAudio.currentTime
        > QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS
      ) {
        quantizedScheduleFrameRef.current = window.requestAnimationFrame(watchBeatBoundary);
        return;
      }

      quantizedScheduleFrameRef.current = null;
      const candidate = resolveQuantizedCandidate(latestAudio);
      if (candidate) startCrossfade(latestAudio, candidate);
    };

    quantizedScheduleFrameRef.current = window.requestAnimationFrame(watchBeatBoundary);
  }, [
    cancelQuantizedSchedule,
    cancelQuantizedWake,
    crossfadeSeconds,
    getActiveAudio,
    player.current?.id,
    player.current?.rhythm,
    player.currentIndex,
    player.playing,
    player.queue,
    player.repeatMode,
    prepareIncomingAudio,
    startCrossfade
  ]);

  useEffect(() => {
    if (!player.playing) return;
    const activeAudio = getActiveAudio();
    if (!activeAudio || activeAudio.paused || activeAudio.ended) return;
    maybeStartCrossfade(activeAudio);
  }, [getActiveAudio, maybeStartCrossfade, player.playing]);

  const handleDeckEnded = useCallback((audio: HTMLAudioElement) => {
    if (dualDeckModeRef.current) return;
    if (audio !== getActiveAudio() || !audio.ended) return;

    const candidate = resolveCrossfadeCandidate({
      queue: player.queue,
      currentIndex: player.currentIndex,
      currentTrackId: player.current?.id ?? null,
      repeatMode: player.repeatMode,
      durationSeconds: crossfadeSeconds,
      visibilityState: document.visibilityState,
      remainingSeconds: 0
    });
    const incomingAudio = getInactiveAudio();
    const incomingTrackId = incomingTrackIdRef.current;

    if (
      !candidate
      || !incomingAudio
      || candidate.trackId !== incomingTrackId
      || incomingAudio.paused
      || incomingAudio.ended
      || incomingAudio.currentTime <= 0
    ) {
      cancelCrossfade();
      player.audioHandlers.onEnded();
      return;
    }

    const visualAttempt = attemptRef.current;
    attemptRef.current += 1;
    cancelAnimation();
    originTrackIdRef.current = null;
    startingTrackIdRef.current = null;
    incomingTrackIdRef.current = null;

    const outgoingDeck = activeDeckRef.current;
    activeDeckRef.current = otherCrossfadeDeck(activeDeckRef.current);
    deckTrackIdsRef.current[activeDeckRef.current] = candidate.trackId;
    incomingAudio.volume = outputVolumeRef.current;
    audio.volume = 0;
    restorePlaybackRate(incomingAudio);

    // A próxima faixa já está carregada e avançou durante o crossfade. Registra a
    // adoção antes de avançar o estado para que o player canônico não faça src/load
    // novamente e não devolva a faixa para 0s.
    player.adoptAudioSource(candidate.trackId, incomingAudio);
    clearAudio(audio);
    deckTrackIdsRef.current[outgoingDeck] = null;
    player.audioHandlers.onPlay();
    player.audioHandlers.onEnded();
    window.requestAnimationFrame(() => clearCrossfadeVisualState(visualAttempt));
  }, [cancelAnimation, cancelCrossfade, clearAudio, crossfadeSeconds, getActiveAudio, getInactiveAudio, player.adoptAudioSource, player.audioHandlers, player.current?.id, player.currentIndex, player.queue, player.repeatMode, restorePlaybackRate]);

  const handleDeckLoadedMetadata = useCallback((audio: HTMLAudioElement) => {
    if (dualDeckModeRef.current) return;
    if (audio === getActiveAudio()) player.audioHandlers.onLoadedMetadata(audio);
  }, [getActiveAudio, player.audioHandlers]);

  const handleDeckPlaying = useCallback((audio: HTMLAudioElement) => {
    if (dualDeckModeRef.current) return;
    if (audio === getActiveAudio() && !audio.paused && !audio.ended) player.audioHandlers.onPlaying();
  }, [getActiveAudio, player.audioHandlers]);

  const handleDeckError = useCallback((audio: HTMLAudioElement) => {
    if (dualDeckModeRef.current) return;
    if (audio === getActiveAudio() && audio.error) {
      cancelCrossfade();
      player.audioHandlers.onError(audio);
      return;
    }

  }, [cancelCrossfade, getActiveAudio, player.audioHandlers]);

  const handleDeckPause = useCallback((audio: HTMLAudioElement) => {
    if (dualDeckModeRef.current) return;
    if (audio === getActiveAudio() && audio.paused) {
      // Alguns browsers emitem `pause` imediatamente antes de `ended` no fim
      // natural. A faixa de entrada já está tocando; manter `playing` evita que o
      // efeito de cancelamento descarte esse deck antes do handoff em `ended`.
      if (isCrossfadeCompletionPause({
        hasIncomingTrack: Boolean(incomingTrackIdRef.current),
        currentTime: audio.currentTime,
        duration: audio.duration,
        ended: audio.ended
      })) return;
      player.audioHandlers.onPause();
      return;
    }
  }, [getActiveAudio, player.audioHandlers]);

  const playTrack = useCallback((track: Track, contextTracks: Track[]) => {
    dualDeckModeRef.current = false;
    cancelCrossfade();
    const source = getTvRemoteMediaSource(track.id);
    const audio = getActiveAudio();
    if (source && audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = outputVolumeRef.current;
      audio.src = source;
      audio.load();
      player.adoptAudioSource(track.id, audio);
    }
    player.playTrack(track, contextTracks);
  }, [cancelCrossfade, getActiveAudio, player.adoptAudioSource, player.playTrack]);

  const togglePlay = useCallback(() => {
    cancelCrossfade();
    return player.togglePlay();
  }, [cancelCrossfade, player.togglePlay]);

  const setStreamingMode = useCallback((mode: StreamingMode) => {
    cancelCrossfade();
    player.setStreamingMode(mode);
  }, [cancelCrossfade, player.setStreamingMode]);

  const setNormalizationMode = useCallback((mode: NormalizationMode) => {
    cancelCrossfade();
    player.setNormalizationMode(mode);
  }, [cancelCrossfade, player.setNormalizationMode]);

  const toggleShuffle = useCallback(() => {
    cancelCrossfade();
    player.toggleShuffle();
  }, [cancelCrossfade, player.toggleShuffle]);

  const cycleRepeat = useCallback(() => {
    cancelCrossfade();
    player.cycleRepeat();
  }, [cancelCrossfade, player.cycleRepeat]);

  const reorderQueue = useCallback((from: number, to: number) => {
    cancelCrossfade();
    player.reorderQueue(from, to);
  }, [cancelCrossfade, player.reorderQueue]);

  const setDualDeckMode = useCallback((active: boolean) => {
    if (dualDeckModeRef.current === active) return;
    if (active) {
      cancelCrossfade();
      dualDeckModeRef.current = true;
      dualDeckMixerRef.current = createDefaultDualDeckMixerState();
      deckTrackIdsRef.current[activeDeckRef.current] = player.current?.id ?? null;
      applyDualDeckMixer();
      return;
    }

    dualDeckModeRef.current = false;
    dualDeckMixerRef.current = createDefaultDualDeckMixerState();
    cancelCrossfade();
  }, [applyDualDeckMixer, cancelCrossfade, player.current?.id]);

  const enterDjSession = useCallback(() => {
    if (normalSessionRef.current) return;

    const activeAudio = getActiveAudio();
    normalSessionRef.current = createNormalPlaybackSessionSnapshot({
      trackId: player.current?.id ?? null,
      currentTimeSeconds: activeAudio && Number.isFinite(activeAudio.currentTime)
        ? activeAudio.currentTime
        : player.currentTime,
      playing: Boolean(activeAudio && !activeAudio.paused && !activeAudio.ended && player.playing),
      activeDeck: activeDeckRef.current
    });

    setDualDeckMode(true);
    for (const deck of ['a', 'b'] as const) {
      const audio = getDeckAudio(deck);
      if (audio) clearDeckAudio(audio);
      deckTrackIdsRef.current[deck] = null;
    }
  }, [
    clearDeckAudio,
    getActiveAudio,
    getDeckAudio,
    player.current?.id,
    player.currentTime,
    player.playing,
    setDualDeckMode
  ]);

  const exitDjSession = useCallback(() => {
    const session = normalSessionRef.current;
    if (!session) {
      setDualDeckMode(false);
      return;
    }

    for (const deck of ['a', 'b'] as const) {
      const audio = getDeckAudio(deck);
      if (audio) pauseDeckAudio(audio);
    }

    activeDeckRef.current = session.activeDeck;
    const activeAudio = getDeckAudio(session.activeDeck);
    const inactiveAudio = getDeckAudio(otherCrossfadeDeck(session.activeDeck));
    if (inactiveAudio) clearDeckAudio(inactiveAudio);

    const currentTrack = session.trackId && player.current?.id === session.trackId
      ? player.current
      : null;

    if (activeAudio && currentTrack) {
      loadDeckAudio(activeAudio, incomingTrackSource(currentTrack), {
        volume: outputVolumeRef.current
      });
      deckTrackIdsRef.current[session.activeDeck] = currentTrack.id;
      deckTrackIdsRef.current[otherCrossfadeDeck(session.activeDeck)] = null;
      player.audioRef.current = activeAudio;
      try {
        activeAudio.currentTime = Math.max(0, session.positionSeconds);
      } catch {
        // Alguns browsers só aceitam seek após metadata; player.seek tenta novamente abaixo.
      }
    }

    normalSessionRef.current = null;
    setDualDeckMode(false);

    if (activeAudio && currentTrack) {
      player.seek(session.positionSeconds);
      if (session.wasPlaying && activeAudio.paused) {
        void player.togglePlay();
      }
    }
  }, [
    clearDeckAudio,
    getDeckAudio,
    incomingTrackSource,
    player.audioRef,
    player.current,
    player.seek,
    player.togglePlay,
    setDualDeckMode
  ]);

  const loadDualDeckTrack = useCallback((deck: DjDeckId, track: Track) => {
    if (!dualDeckModeRef.current) return false;
    const audio = getDeckAudio(deck);
    if (!audio) return false;

    cancelAnimation();
    cancelQuantizedSchedule();
    cancelQuantizedWake();
    cancelPlaybackRateRestore();
    loadDeckAudio(audio, incomingTrackSource(track), {
      volume: resolveDualDeckOutputGain({
        deck,
        masterVolume: outputVolumeRef.current,
        channelVolume: dualDeckMixerRef.current.channelVolumes[deck],
        crossfader: dualDeckMixerRef.current.crossfader
      })
    });
    deckTrackIdsRef.current[deck] = track.id;
    return true;
  }, [
    cancelAnimation,
    cancelPlaybackRateRestore,
    cancelQuantizedSchedule,
    cancelQuantizedWake,
    getDeckAudio,
    incomingTrackSource
  ]);

  const unloadDualDeck = useCallback((deck: DjDeckId) => {
    if (!dualDeckModeRef.current) return false;
    const audio = getDeckAudio(deck);
    if (!audio) return false;
    clearDeckAudio(audio);
    deckTrackIdsRef.current[deck] = null;
    return true;
  }, [getDeckAudio]);

  const playDualDeck = useCallback(async (deck: DjDeckId) => {
    if (!dualDeckModeRef.current) return false;
    const audio = getDeckAudio(deck);
    if (!audio || !deckTrackIdsRef.current[deck]) return false;
    return playDeckAudio(audio);
  }, [getDeckAudio]);

  const pauseDualDeck = useCallback((deck: DjDeckId) => {
    if (!dualDeckModeRef.current) return false;
    const audio = getDeckAudio(deck);
    if (!audio) return false;
    pauseDeckAudio(audio);
    return true;
  }, [getDeckAudio]);

  const seekDualDeck = useCallback((deck: DjDeckId, seconds: number) => {
    if (!dualDeckModeRef.current) return null;
    const audio = getDeckAudio(deck);
    return audio ? seekDeckAudio(audio, seconds) : null;
  }, [getDeckAudio]);

  const setDualDeckPlaybackRate = useCallback((deck: DjDeckId, playbackRate: number) => {
    if (!dualDeckModeRef.current) return null;
    const audio = getDeckAudio(deck);
    return audio ? setDeckPlaybackRate(audio, playbackRate) : null;
  }, [getDeckAudio]);

  const setDualDeckVolume = useCallback((deck: DjDeckId, volume: number) => {
    if (!dualDeckModeRef.current) return null;
    dualDeckMixerRef.current.channelVolumes[deck] = Math.max(0, Math.min(1, volume));
    applyDualDeckMixer();
    return dualDeckMixerRef.current.channelVolumes[deck];
  }, [applyDualDeckMixer]);

  const setDualDeckCrossfader = useCallback((value: number) => {
    if (!dualDeckModeRef.current) return null;
    dualDeckMixerRef.current.crossfader = Math.max(-1, Math.min(1, value));
    applyDualDeckMixer();
    return dualDeckMixerRef.current.crossfader;
  }, [applyDualDeckMixer]);

  const getDualDeckMixerSnapshot = useCallback(() => ({
    channelVolumes: { ...dualDeckMixerRef.current.channelVolumes },
    crossfader: dualDeckMixerRef.current.crossfader
  }), []);

  const getDualDeckSnapshot = useCallback((deck: DjDeckId) => {
    const audio = getDeckAudio(deck);
    return audio
      ? readDeckAudioSnapshot(deck, deckTrackIdsRef.current[deck], audio)
      : null;
  }, [getDeckAudio]);

  return {
    ...player,
    deckARef,
    deckBRef,
    djSession: {
      enter: enterDjSession,
      exit: exitDjSession,
      active: () => normalSessionRef.current != null
    },
    dualDeck: {
      setMode: setDualDeckMode,
      loadTrack: loadDualDeckTrack,
      unload: unloadDualDeck,
      play: playDualDeck,
      pause: pauseDualDeck,
      seek: seekDualDeck,
      setPlaybackRate: setDualDeckPlaybackRate,
      setVolume: setDualDeckVolume,
      setCrossfader: setDualDeckCrossfader,
      getMixerSnapshot: getDualDeckMixerSnapshot,
      getSnapshot: getDualDeckSnapshot
    },
    crossfadeSeconds,
    setCrossfadeSeconds,
    playTrack,
    togglePlay,
    setStreamingMode,
    setNormalizationMode,
    toggleShuffle,
    cycleRepeat,
    reorderQueue,
    audioHandlers: {
      onPlay: (audio: HTMLAudioElement) => {
        if (dualDeckModeRef.current) return;
        if (audio === getActiveAudio() && !audio.paused && !audio.ended) player.audioHandlers.onPlay();
      },
      onPlaying: handleDeckPlaying,
      onWaiting: (audio: HTMLAudioElement) => { if (!dualDeckModeRef.current && audio === getActiveAudio()) player.audioHandlers.onWaiting(audio); },
      onCanPlay: (audio: HTMLAudioElement) => { if (!dualDeckModeRef.current && audio === getActiveAudio()) player.audioHandlers.onCanPlay(audio); },
      onAbort: (audio: HTMLAudioElement) => { if (!dualDeckModeRef.current && audio === getActiveAudio()) player.audioHandlers.onAbort(audio); },
      onPause: handleDeckPause,
      onTimeUpdate: (audio: HTMLAudioElement) => {
        if (dualDeckModeRef.current || audio !== getActiveAudio()) return;
        player.audioHandlers.onTimeUpdate(audio);
        maybeStartCrossfade(audio);
      },
      onLoadedMetadata: handleDeckLoadedMetadata,
      onEnded: handleDeckEnded,
      onError: handleDeckError
    }
  };
}
