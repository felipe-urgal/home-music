import { useCallback, useEffect, useRef, useState } from 'react';
import type { NormalizationMode, Track } from '@home-music/shared';
import {
  readCrossfadeMode,
  resolveCrossfadeCandidate,
  writeCrossfadeMode,
  type CrossfadeMode
} from './crossfade';
import { resolveOutputVolume } from './player-state';
import {
  effectiveNormalizationMode,
  onlineAudioUrl,
  type StreamingMode
} from './streaming-quality';
import { useAudioPlayer } from './useAudioPlayer';

function initialCrossfadeMode(): CrossfadeMode {
  try {
    return readCrossfadeMode(window.localStorage);
  } catch {
    return 'off';
  }
}

function persistCrossfadeMode(mode: CrossfadeMode) {
  try {
    writeCrossfadeMode(window.localStorage, mode);
  } catch {
    // Preferência local e best-effort; playback não depende da persistência.
  }
}

type PendingHandoff = {
  trackId: string;
  position: number;
};

export function useCrossfadeAudioPlayer(
  tracks: Track[],
  progressVisible: boolean,
  libraryReady: boolean,
  usesSystemVolume: boolean
) {
  const player = useAudioPlayer(tracks, progressVisible, libraryReady, usesSystemVolume);
  const transitionAudioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const originTrackIdRef = useRef<string | null>(null);
  const startingTrackIdRef = useRef<string | null>(null);
  const activeTrackIdRef = useRef<string | null>(null);
  const pendingHandoffRef = useRef<PendingHandoff | null>(null);
  const currentTrackIdRef = useRef<string | null>(player.current?.id ?? null);
  const outputVolumeRef = useRef(resolveOutputVolume(player.volume, usesSystemVolume));
  const [crossfadeMode, setCrossfadeModeState] = useState<CrossfadeMode>(initialCrossfadeMode);

  currentTrackIdRef.current = player.current?.id ?? null;
  outputVolumeRef.current = resolveOutputVolume(player.volume, usesSystemVolume);

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current == null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const clearTransitionAudio = useCallback(() => {
    const transitionAudio = transitionAudioRef.current;
    if (!transitionAudio) return;
    transitionAudio.pause();
    transitionAudio.volume = 0;
    transitionAudio.removeAttribute('src');
    transitionAudio.load();
  }, []);

  const cancelCrossfade = useCallback(() => {
    attemptRef.current += 1;
    cancelAnimation();
    originTrackIdRef.current = null;
    startingTrackIdRef.current = null;
    activeTrackIdRef.current = null;
    pendingHandoffRef.current = null;
    clearTransitionAudio();

    const primaryAudio = player.audioRef.current;
    if (primaryAudio) primaryAudio.volume = outputVolumeRef.current;
  }, [cancelAnimation, clearTransitionAudio, player.audioRef]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') cancelCrossfade();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [cancelCrossfade]);

  useEffect(() => {
    const currentTrackId = player.current?.id ?? null;
    const pendingHandoff = pendingHandoffRef.current;
    if (pendingHandoff?.trackId === currentTrackId) return;

    const originTrackId = originTrackIdRef.current;
    if (originTrackId && originTrackId !== currentTrackId) cancelCrossfade();
  }, [cancelCrossfade, player.current?.id]);

  useEffect(() => {
    if (!player.playing && !pendingHandoffRef.current) cancelCrossfade();
  }, [cancelCrossfade, player.playing]);

  useEffect(() => () => {
    attemptRef.current += 1;
    cancelAnimation();
    clearTransitionAudio();
  }, [cancelAnimation, clearTransitionAudio]);

  const setCrossfadeMode = useCallback((mode: CrossfadeMode) => {
    cancelCrossfade();
    persistCrossfadeMode(mode);
    setCrossfadeModeState(mode);
  }, [cancelCrossfade]);

  const maybeStartCrossfade = useCallback((primaryAudio: HTMLAudioElement) => {
    if (!player.playing || primaryAudio.paused || primaryAudio.ended) return;
    if (startingTrackIdRef.current || activeTrackIdRef.current || pendingHandoffRef.current) return;
    if (!Number.isFinite(primaryAudio.duration) || primaryAudio.duration <= 0) return;

    const candidate = resolveCrossfadeCandidate({
      queue: player.queue,
      currentIndex: player.currentIndex,
      currentTrackId: player.current?.id ?? null,
      repeatMode: player.repeatMode,
      mode: crossfadeMode,
      visibilityState: document.visibilityState,
      remainingSeconds: Math.max(0, primaryAudio.duration - primaryAudio.currentTime)
    });
    if (!candidate) return;

    const nextTrack = player.queue.find(track => track.id === candidate.trackId);
    const transitionAudio = transitionAudioRef.current;
    const originTrackId = player.current?.id ?? null;
    if (!nextTrack || !transitionAudio || !originTrackId) return;

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    originTrackIdRef.current = originTrackId;
    startingTrackIdRef.current = candidate.trackId;
    activeTrackIdRef.current = null;
    transitionAudio.pause();
    transitionAudio.volume = 0;
    transitionAudio.currentTime = 0;
    transitionAudio.src = onlineAudioUrl(
      nextTrack.id,
      player.streamingMode,
      false,
      effectiveNormalizationMode(nextTrack, player.normalizationMode)
    );
    transitionAudio.load();

    void transitionAudio.play()
      .then(() => {
        if (
          attemptRef.current !== attempt
          || currentTrackIdRef.current !== originTrackId
          || document.visibilityState !== 'visible'
        ) {
          cancelCrossfade();
          return;
        }

        startingTrackIdRef.current = null;
        activeTrackIdRef.current = candidate.trackId;

        const animate = () => {
          if (attemptRef.current !== attempt) return;
          if (primaryAudio.ended) {
            animationFrameRef.current = null;
            return;
          }
          if (
            document.visibilityState !== 'visible'
            || primaryAudio.paused
            || transitionAudio.paused
            || transitionAudio.ended
            || transitionAudio.error
          ) {
            cancelCrossfade();
            return;
          }

          const remainingSeconds = Number.isFinite(primaryAudio.duration)
            ? primaryAudio.duration - primaryAudio.currentTime
            : candidate.durationSeconds;
          if (remainingSeconds > candidate.durationSeconds + 0.75) {
            cancelCrossfade();
            return;
          }

          const progress = Math.max(
            0,
            Math.min(1, transitionAudio.currentTime / candidate.durationSeconds)
          );
          const outputVolume = outputVolumeRef.current;
          primaryAudio.volume = outputVolume * (1 - progress);
          transitionAudio.volume = outputVolume * progress;
          animationFrameRef.current = window.requestAnimationFrame(animate);
        };

        animationFrameRef.current = window.requestAnimationFrame(animate);
      })
      .catch(() => {
        if (attemptRef.current === attempt) cancelCrossfade();
      });
  }, [cancelCrossfade, crossfadeMode, player.current?.id, player.currentIndex, player.normalizationMode, player.playing, player.queue, player.repeatMode, player.streamingMode]);

  const handleEnded = useCallback(() => {
    const transitionAudio = transitionAudioRef.current;
    const activeTrackId = activeTrackIdRef.current;
    const candidate = resolveCrossfadeCandidate({
      queue: player.queue,
      currentIndex: player.currentIndex,
      currentTrackId: player.current?.id ?? null,
      repeatMode: player.repeatMode,
      mode: crossfadeMode,
      visibilityState: document.visibilityState,
      remainingSeconds: 0
    });

    if (
      !transitionAudio
      || !candidate
      || candidate.trackId !== activeTrackId
      || transitionAudio.paused
      || transitionAudio.ended
      || transitionAudio.currentTime <= 0
    ) {
      cancelCrossfade();
      player.audioHandlers.onEnded();
      return;
    }

    attemptRef.current += 1;
    cancelAnimation();
    originTrackIdRef.current = null;
    startingTrackIdRef.current = null;
    activeTrackIdRef.current = null;
    pendingHandoffRef.current = {
      trackId: candidate.trackId,
      position: transitionAudio.currentTime
    };
    transitionAudio.volume = outputVolumeRef.current;

    const primaryAudio = player.audioRef.current;
    if (primaryAudio) primaryAudio.volume = 0;
    player.audioHandlers.onEnded();
  }, [cancelAnimation, cancelCrossfade, crossfadeMode, player.audioHandlers, player.audioRef, player.current?.id, player.currentIndex, player.queue, player.repeatMode]);

  const handleLoadedMetadata = useCallback((audio: HTMLAudioElement) => {
    player.audioHandlers.onLoadedMetadata(audio);
    const pendingHandoff = pendingHandoffRef.current;
    if (!pendingHandoff || pendingHandoff.trackId !== player.current?.id) return;

    const maximum = Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.max(0, audio.duration - 0.05)
      : pendingHandoff.position;
    const position = Math.min(pendingHandoff.position, maximum);
    if (position > 0) player.seek(position);
  }, [player.audioHandlers, player.current?.id, player.seek]);

  const handlePlaying = useCallback(() => {
    const pendingHandoff = pendingHandoffRef.current;
    if (!pendingHandoff || pendingHandoff.trackId !== player.current?.id) return;

    pendingHandoffRef.current = null;
    clearTransitionAudio();
    const primaryAudio = player.audioRef.current;
    if (primaryAudio) primaryAudio.volume = outputVolumeRef.current;
  }, [clearTransitionAudio, player.audioRef, player.current?.id]);

  const handlePrimaryError = useCallback((audio: HTMLAudioElement) => {
    if (
      startingTrackIdRef.current
      || activeTrackIdRef.current
      || pendingHandoffRef.current
    ) cancelCrossfade();
    player.audioHandlers.onError(audio);
  }, [cancelCrossfade, player.audioHandlers]);

  const togglePlay = useCallback(() => {
    cancelCrossfade();
    return player.togglePlay();
  }, [cancelCrossfade, player.togglePlay]);

  const next = useCallback(() => {
    cancelCrossfade();
    player.next();
  }, [cancelCrossfade, player.next]);

  const previous = useCallback(() => {
    cancelCrossfade();
    player.previous();
  }, [cancelCrossfade, player.previous]);

  const seek = useCallback((value: number) => {
    cancelCrossfade();
    player.seek(value);
  }, [cancelCrossfade, player.seek]);

  const playTrack = useCallback((track: Track, contextTracks: Track[]) => {
    cancelCrossfade();
    player.playTrack(track, contextTracks);
  }, [cancelCrossfade, player.playTrack]);

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
    transitionAudioRef,
    crossfadeMode,
    setCrossfadeMode,
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
      ...player.audioHandlers,
      onTimeUpdate: (audio: HTMLAudioElement) => {
        player.audioHandlers.onTimeUpdate(audio);
        maybeStartCrossfade(audio);
      },
      onLoadedMetadata: handleLoadedMetadata,
      onEnded: handleEnded,
      onError: handlePrimaryError,
      onPlaying: handlePlaying
    },
    transitionAudioHandlers: {
      onError: cancelCrossfade,
      onEnded: cancelCrossfade
    }
  };
}
