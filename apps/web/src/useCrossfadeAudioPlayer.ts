import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NormalizationMode, Track } from '@home-music/shared';
import { isAppleMobileWebKit } from './background-playback';
import {
  isCrossfadeCompletionPause,
  normalizeCrossfadeSeconds,
  otherCrossfadeDeck,
  readCrossfadeSeconds,
  resolveCrossfadeCandidate,
  resolveManualCrossfadeCandidate,
  writeCrossfadeSeconds,
  type CrossfadeDeck
} from './crossfade';
import {
  clearCrossfadeVisualState,
  setCrossfadeVisualState,
  syncCrossfadeVisualElapsed
} from './crossfade-visual';
import { offlineAudioUrl } from './offline-downloads';
import { nextTrackDecision, resolveOutputVolume } from './player-state';
import {
  effectiveNormalizationMode,
  onlineAudioUrl,
  type StreamingMode
} from './streaming-quality';
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
};

export function useCrossfadeAudioPlayer(
  tracks: Track[],
  progressVisible: boolean,
  libraryReady: boolean,
  usesSystemVolume: boolean,
  options: CrossfadeAudioPlayerOptions = {}
) {
  const offlineMode = Boolean(options.offlineMode);
  const player = useAudioPlayer(tracks, progressVisible, libraryReady, usesSystemVolume, options);
  const deckARef = useRef<HTMLAudioElement>(null);
  const deckBRef = useRef<HTMLAudioElement>(null);
  const activeDeckRef = useRef<CrossfadeDeck>('a');
  const animationFrameRef = useRef<number | null>(null);
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
    audio.removeAttribute('src');
    audio.load();
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current == null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const cancelCrossfade = useCallback(() => {
    attemptRef.current += 1;
    cancelAnimation();
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
  }, [cancelAnimation, clearAudio, getActiveAudio, getInactiveAudio, player.audioRef]);

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
    if (!player.playing && (startingTrackIdRef.current || incomingTrackIdRef.current)) {
      cancelCrossfade();
    }
  }, [cancelCrossfade, player.playing]);

  useEffect(() => () => {
    attemptRef.current += 1;
    cancelAnimation();
    clearCrossfadeVisualState();
    clearAudio(deckARef.current);
    clearAudio(deckBRef.current);
  }, [cancelAnimation, clearAudio]);

  const setCrossfadeSeconds = useCallback((seconds: number) => {
    const normalizedSeconds = normalizeCrossfadeSeconds(seconds);
    cancelCrossfade();
    persistCrossfadeSeconds(normalizedSeconds);
    setCrossfadeSecondsState(normalizedSeconds);
  }, [cancelCrossfade]);

  const startManualCrossfade = useCallback((
    nextTrack: Track,
    onCommit: (activeAudio: HTMLAudioElement) => void
  ) => {
    if (isAppleMobileWebKit(navigator)) return false;

    const candidate = resolveManualCrossfadeCandidate({
      currentTrackId: player.current?.id ?? null,
      targetTrackId: nextTrack.id,
      durationSeconds: crossfadeSeconds,
      playing: player.playing,
      visibilityState: document.visibilityState
    });
    if (!candidate) return false;

    cancelCrossfade();

    const activeAudio = getActiveAudio();
    const incomingAudio = getInactiveAudio();
    const originTrackId = player.current?.id ?? null;
    if (
      !activeAudio
      || !incomingAudio
      || !originTrackId
      || activeAudio.paused
      || activeAudio.ended
    ) return false;

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    originTrackIdRef.current = originTrackId;
    startingTrackIdRef.current = candidate.trackId;
    incomingTrackIdRef.current = null;

    const fallbackToImmediateChange = () => {
      if (
        attemptRef.current !== attempt
        || currentTrackIdRef.current !== originTrackId
      ) return;
      cancelCrossfade();
      onCommit(activeAudio);
    };

    const finishCrossfade = () => {
      if (attemptRef.current !== attempt) return;
      const visualAttempt = attempt;
      attemptRef.current += 1;
      cancelAnimation();
      originTrackIdRef.current = null;
      startingTrackIdRef.current = null;
      incomingTrackIdRef.current = null;

      // Atualiza o estado canônico antes de adotar o deck de entrada. Os setters do
      // React só renderizam depois deste callback, então a fonte adotada já estará
      // registrada quando o novo current chegar ao useAudioPlayer.
      onCommit(activeAudio);
      activeDeckRef.current = otherCrossfadeDeck(activeDeckRef.current);
      incomingAudio.volume = outputVolumeRef.current;
      activeAudio.volume = 0;
      player.adoptAudioSource(candidate.trackId, incomingAudio);
      clearAudio(activeAudio);
      player.audioHandlers.onPlay();
      window.requestAnimationFrame(() => clearCrossfadeVisualState(visualAttempt));
    };

    clearAudio(incomingAudio);
    incomingAudio.volume = 0;
    incomingAudio.src = offlineMode
      ? offlineAudioUrl(nextTrack.id)
      : onlineAudioUrl(
          nextTrack.id,
          player.streamingMode,
          false,
          effectiveNormalizationMode(nextTrack, player.normalizationMode)
        );
    incomingAudio.load();

    void incomingAudio.play()
      .then(() => {
        if (
          attemptRef.current !== attempt
          || currentTrackIdRef.current !== originTrackId
          || document.visibilityState !== 'visible'
          || getActiveAudio() !== activeAudio
        ) {
          fallbackToImmediateChange();
          return;
        }

        startingTrackIdRef.current = null;
        incomingTrackIdRef.current = candidate.trackId;
        setCrossfadeVisualState({
          attempt,
          originTrackId,
          incomingTrack: nextTrack,
          durationSeconds: candidate.durationSeconds,
          elapsedSeconds: Math.max(0, Math.min(candidate.durationSeconds, incomingAudio.currentTime))
        });

        const animate = () => {
          if (attemptRef.current !== attempt) return;
          if (
            document.visibilityState !== 'visible'
            || activeAudio.paused
            || activeAudio.ended
            || incomingAudio.paused
            || incomingAudio.ended
            || incomingAudio.error
          ) {
            fallbackToImmediateChange();
            return;
          }

          const progress = Math.max(
            0,
            Math.min(1, incomingAudio.currentTime / candidate.durationSeconds)
          );
          syncCrossfadeVisualElapsed(attempt, progress * candidate.durationSeconds);
          const outputVolume = outputVolumeRef.current;
          const angle = progress * Math.PI * 0.5;
          activeAudio.volume = outputVolume * Math.cos(angle);
          incomingAudio.volume = outputVolume * Math.sin(angle);

          if (progress >= 1) {
            animationFrameRef.current = null;
            finishCrossfade();
            return;
          }

          animationFrameRef.current = window.requestAnimationFrame(animate);
        };

        animationFrameRef.current = window.requestAnimationFrame(animate);
      })
      .catch(() => fallbackToImmediateChange());

    return true;
  }, [cancelAnimation, cancelCrossfade, clearAudio, crossfadeSeconds, getActiveAudio, getInactiveAudio, offlineMode, player.adoptAudioSource, player.audioHandlers, player.current?.id, player.normalizationMode, player.playing, player.streamingMode]);

  const maybeStartCrossfade = useCallback((activeAudio: HTMLAudioElement) => {
    if (isAppleMobileWebKit(navigator)) return;
    if (activeAudio !== getActiveAudio()) return;
    if (!player.playing || activeAudio.paused || activeAudio.ended) return;
    if (startingTrackIdRef.current || incomingTrackIdRef.current) return;
    if (!Number.isFinite(activeAudio.duration) || activeAudio.duration <= 0) return;

    const candidate = resolveCrossfadeCandidate({
      queue: player.queue,
      currentIndex: player.currentIndex,
      currentTrackId: player.current?.id ?? null,
      repeatMode: player.repeatMode,
      durationSeconds: crossfadeSeconds,
      visibilityState: document.visibilityState,
      remainingSeconds: Math.max(0, activeAudio.duration - activeAudio.currentTime)
    });
    if (!candidate) return;

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
    incomingAudio.src = offlineMode
      ? offlineAudioUrl(nextTrack.id)
      : onlineAudioUrl(
          nextTrack.id,
          player.streamingMode,
          false,
          effectiveNormalizationMode(nextTrack, player.normalizationMode)
        );
    incomingAudio.load();

    void incomingAudio.play()
      .then(() => {
        if (
          attemptRef.current !== attempt
          || currentTrackIdRef.current !== originTrackId
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
          elapsedSeconds: Math.max(0, Math.min(candidate.durationSeconds, incomingAudio.currentTime))
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

          const progress = Math.max(
            0,
            Math.min(1, incomingAudio.currentTime / candidate.durationSeconds)
          );
          syncCrossfadeVisualElapsed(attempt, incomingAudio.currentTime);
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
  }, [cancelCrossfade, clearAudio, crossfadeSeconds, getActiveAudio, getInactiveAudio, offlineMode, player.current?.id, player.currentIndex, player.normalizationMode, player.playing, player.queue, player.repeatMode, player.streamingMode]);

  const handleDeckEnded = useCallback((audio: HTMLAudioElement) => {
    if (audio !== getActiveAudio()) {
      if (incomingTrackIdRef.current || startingTrackIdRef.current) cancelCrossfade();
      return;
    }

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
    if (audio === getActiveAudio()) player.audioHandlers.onPlay();
  }, [getActiveAudio, player.audioHandlers]);

  const handleDeckError = useCallback((audio: HTMLAudioElement) => {
    if (audio === getActiveAudio()) {
      cancelCrossfade();
      player.audioHandlers.onError(audio);
      return;
    }

    if (startingTrackIdRef.current || incomingTrackIdRef.current) cancelCrossfade();
  }, [cancelCrossfade, getActiveAudio, player.audioHandlers]);

  const handleDeckPause = useCallback((audio: HTMLAudioElement) => {
    if (audio === getActiveAudio()) {
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
    if (startingTrackIdRef.current || incomingTrackIdRef.current) cancelCrossfade();
  }, [cancelCrossfade, getActiveAudio, player.audioHandlers]);

  const togglePlay = useCallback(() => {
    cancelCrossfade();
    return player.togglePlay();
  }, [cancelCrossfade, player.togglePlay]);

  const next = useCallback(() => {
    const decision = nextTrackDecision(player.queue, player.currentIndex, player.repeatMode, false);
    const nextTrack = decision.type === 'track'
      ? player.queue.find(track => track.id === decision.id)
      : undefined;

    if (nextTrack && startManualCrossfade(nextTrack, () => player.next())) return;
    cancelCrossfade();
    player.next();
  }, [cancelCrossfade, player.currentIndex, player.next, player.queue, player.repeatMode, startManualCrossfade]);

  const previous = useCallback(() => {
    const activeAudio = getActiveAudio();
    if (!activeAudio || activeAudio.currentTime > 3) {
      cancelCrossfade();
      player.previous();
      return;
    }

    const previousTrack = player.currentIndex > 0
      ? player.queue[player.currentIndex - 1]
      : player.repeatMode === 'all' && player.queue.length > 1
        ? player.queue[player.queue.length - 1]
        : undefined;

    if (previousTrack && startManualCrossfade(previousTrack, outgoingAudio => {
      outgoingAudio.currentTime = 0;
      player.previous();
    })) return;

    cancelCrossfade();
    player.previous();
  }, [cancelCrossfade, getActiveAudio, player.currentIndex, player.previous, player.queue, player.repeatMode, startManualCrossfade]);

  const seek = useCallback((value: number) => {
    cancelCrossfade();
    player.seek(value);
  }, [cancelCrossfade, player.seek]);

  const playTrack = useCallback((track: Track, contextTracks: Track[]) => {
    if (startManualCrossfade(track, () => player.playTrack(track, contextTracks))) return;
    cancelCrossfade();
    player.playTrack(track, contextTracks);
  }, [cancelCrossfade, player.playTrack, startManualCrossfade]);

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
    togglePlay,
    next,
    previous,
    seek,
    playTrack,
    setStreamingMode,
    setNormalizationMode,
    toggleShuffle,
    cycleRepeat,
    reorderQueue,
    audioHandlers: {
      onPlay: (audio: HTMLAudioElement) => {
        if (audio === getActiveAudio()) player.audioHandlers.onPlay();
      },
      onPlaying: handleDeckPlaying,
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
