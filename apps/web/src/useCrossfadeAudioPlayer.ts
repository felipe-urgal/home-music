import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NormalizationMode, Track } from '@home-music/shared';
import { isAppleMobileWebKit } from './background-playback';
import {
  QUANTIZED_CROSSFADE_ARM_SECONDS,
  QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS,
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
  const animationFrameRef = useRef<number | null>(null);
  const quantizedScheduleFrameRef = useRef<number | null>(null);
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

  const getDeckAudio = useCallback((deck: CrossfadeDeck) => (
    deck === 'a' ? deckARef.current : deckBRef.current
  ), []);

  const getActiveAudio = useCallback(() => getDeckAudio(activeDeckRef.current), [getDeckAudio]);

  const getInactiveAudio = useCallback(() => (
    getDeckAudio(otherCrossfadeDeck(activeDeckRef.current))
  ), [getDeckAudio]);

  const clearAudio = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) return;
    audio.pause();
    audio.volume = 0;
    audio.playbackRate = 1;
    audio.preservesPitch = true;
    audio.removeAttribute('src');
    audio.load();
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

  const cancelCrossfade = useCallback(() => {
    attemptRef.current += 1;
    cancelAnimation();
    cancelQuantizedSchedule();
    originTrackIdRef.current = null;
    startingTrackIdRef.current = null;
    incomingTrackIdRef.current = null;
    clearCrossfadeVisualState();

    const activeAudio = getActiveAudio();
    const inactiveAudio = getInactiveAudio();
    if (activeAudio) {
      player.audioRef.current = activeAudio;
      activeAudio.volume = outputVolumeRef.current;
    }
    if (inactiveAudio && inactiveAudio !== activeAudio) clearAudio(inactiveAudio);
  }, [cancelAnimation, cancelQuantizedSchedule, clearAudio, getActiveAudio, getInactiveAudio, player.audioRef]);

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
      )
    ) {
      cancelCrossfade();
    }
  }, [cancelCrossfade, player.playing]);

  useEffect(() => () => {
    attemptRef.current += 1;
    cancelAnimation();
    cancelQuantizedSchedule();
    clearCrossfadeVisualState();
    clearAudio(deckARef.current);
    clearAudio(deckBRef.current);
  }, [cancelAnimation, cancelQuantizedSchedule, clearAudio]);

  const setCrossfadeSeconds = useCallback((seconds: number) => {
    const normalizedSeconds = normalizeCrossfadeSeconds(seconds);
    cancelCrossfade();
    persistCrossfadeSeconds(normalizedSeconds);
    setCrossfadeSecondsState(normalizedSeconds);
  }, [cancelCrossfade]);

  const startCrossfade = useCallback((
    activeAudio: HTMLAudioElement,
    candidate: CrossfadeCandidate
  ) => {
    if (activeAudio !== getActiveAudio()) return;
    if (!player.playing || activeAudio.paused || activeAudio.ended) return;
    if (startingTrackIdRef.current || incomingTrackIdRef.current) return;

    cancelQuantizedSchedule();

    const nextTrack = player.queue.find(track => track.id === candidate.trackId);
    const incomingAudio = getInactiveAudio();
    const originTrackId = player.current?.id ?? null;
    if (!nextTrack || !incomingAudio || !originTrackId) return;

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    originTrackIdRef.current = originTrackId;
    startingTrackIdRef.current = candidate.trackId;
    incomingTrackIdRef.current = null;

    clearAudio(incomingAudio);
    incomingAudio.volume = 0;
    incomingAudio.src = getTvRemoteMediaSource(nextTrack.id) ?? (offlineMode
      ? offlineAudioUrl(nextTrack.id)
      : onlineAudioUrl(
          nextTrack.id,
          player.streamingMode,
          false,
          effectiveNormalizationMode(nextTrack, player.normalizationMode)
        ));
    incomingAudio.load();

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
    clearAudio,
    getActiveAudio,
    getInactiveAudio,
    offlineMode,
    player.current?.id,
    player.normalizationMode,
    player.playing,
    player.queue,
    player.streamingMode
  ]);

  const maybeStartCrossfade = useCallback((activeAudio: HTMLAudioElement) => {
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

    const timeUntilStart = quantizedPlan.startTimeSeconds - activeAudio.currentTime;
    if (timeUntilStart > QUANTIZED_CROSSFADE_ARM_SECONDS) {
      cancelQuantizedSchedule();
      return;
    }

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
    crossfadeSeconds,
    getActiveAudio,
    player.current?.id,
    player.current?.rhythm,
    player.currentIndex,
    player.playing,
    player.queue,
    player.repeatMode,
    startCrossfade
  ]);

  const handleDeckEnded = useCallback((audio: HTMLAudioElement) => {
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

    activeDeckRef.current = otherCrossfadeDeck(activeDeckRef.current);
    incomingAudio.volume = outputVolumeRef.current;
    audio.volume = 0;

    // A próxima faixa já está carregada e avançou durante o crossfade. Registra a
    // adoção antes de avançar o estado para que o player canônico não faça src/load
    // novamente e não devolva a faixa para 0s.
    player.adoptAudioSource(candidate.trackId, incomingAudio);
    clearAudio(audio);
    player.audioHandlers.onPlay();
    player.audioHandlers.onEnded();
    window.requestAnimationFrame(() => clearCrossfadeVisualState(visualAttempt));
  }, [cancelAnimation, cancelCrossfade, clearAudio, crossfadeSeconds, getActiveAudio, getInactiveAudio, player.adoptAudioSource, player.audioHandlers, player.current?.id, player.currentIndex, player.queue, player.repeatMode]);

  const handleDeckLoadedMetadata = useCallback((audio: HTMLAudioElement) => {
    if (audio === getActiveAudio()) player.audioHandlers.onLoadedMetadata(audio);
  }, [getActiveAudio, player.audioHandlers]);

  const handleDeckPlaying = useCallback((audio: HTMLAudioElement) => {
    if (audio === getActiveAudio() && !audio.paused && !audio.ended) player.audioHandlers.onPlaying();
  }, [getActiveAudio, player.audioHandlers]);

  const handleDeckError = useCallback((audio: HTMLAudioElement) => {
    if (audio === getActiveAudio() && audio.error) {
      cancelCrossfade();
      player.audioHandlers.onError(audio);
      return;
    }

  }, [cancelCrossfade, getActiveAudio, player.audioHandlers]);

  const handleDeckPause = useCallback((audio: HTMLAudioElement) => {
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

  return {
    ...player,
    deckARef,
    deckBRef,
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
        if (audio === getActiveAudio() && !audio.paused && !audio.ended) player.audioHandlers.onPlay();
      },
      onPlaying: handleDeckPlaying,
      onWaiting: (audio: HTMLAudioElement) => { if (audio === getActiveAudio()) player.audioHandlers.onWaiting(audio); },
      onCanPlay: (audio: HTMLAudioElement) => { if (audio === getActiveAudio()) player.audioHandlers.onCanPlay(audio); },
      onAbort: (audio: HTMLAudioElement) => { if (audio === getActiveAudio()) player.audioHandlers.onAbort(audio); },
      onPause: handleDeckPause,
      onTimeUpdate: (audio: HTMLAudioElement) => {
        if (audio !== getActiveAudio()) return;
        player.audioHandlers.onTimeUpdate(audio);
        maybeStartCrossfade(audio);
      },
      onLoadedMetadata: handleDeckLoadedMetadata,
      onEnded: handleDeckEnded,
      onError: handleDeckError
    }
  };
}
