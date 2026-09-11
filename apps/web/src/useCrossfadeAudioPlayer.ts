import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NormalizationMode, Track } from '@home-music/shared';
import { markAdoptedAudioTrack } from './audio-adoption';
import { isAppleMobileWebKit } from './background-playback';
import {
  normalizeCrossfadeSeconds,
  readCrossfadeSeconds,
  resolveCrossfadeCandidate,
  writeCrossfadeSeconds
} from './crossfade';
import { resolveOutputVolume } from './player-state';
import {
  effectiveNormalizationMode,
  onlineAudioUrl,
  type StreamingMode
} from './streaming-quality';
import { useAudioPlayer } from './useAudioPlayer';

type Deck = 'a' | 'b';

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

export function useCrossfadeAudioPlayer(
  tracks: Track[],
  progressVisible: boolean,
  libraryReady: boolean,
  usesSystemVolume: boolean
) {
  const player = useAudioPlayer(tracks, progressVisible, libraryReady, usesSystemVolume);
  const deckARef = useRef<HTMLAudioElement>(null);
  const deckBRef = useRef<HTMLAudioElement>(null);
  const activeDeckRef = useRef<Deck>('a');
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

  const getDeckAudio = useCallback((deck: Deck) => (
    deck === 'a' ? deckARef.current : deckBRef.current
  ), []);

  const getActiveAudio = useCallback(() => getDeckAudio(activeDeckRef.current), [getDeckAudio]);

  const getInactiveAudio = useCallback(() => (
    getDeckAudio(activeDeckRef.current === 'a' ? 'b' : 'a')
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

    const activeAudio = player.audioRef.current ?? getActiveAudio();
    const inactiveAudio = getInactiveAudio();
    if (inactiveAudio && inactiveAudio !== activeAudio) clearAudio(inactiveAudio);
    if (activeAudio) activeAudio.volume = outputVolumeRef.current;
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
    clearAudio(deckARef.current);
    clearAudio(deckBRef.current);
  }, [cancelAnimation, clearAudio]);

  const setCrossfadeSeconds = useCallback((seconds: number) => {
    const normalizedSeconds = normalizeCrossfadeSeconds(seconds);
    cancelCrossfade();
    persistCrossfadeSeconds(normalizedSeconds);
    setCrossfadeSecondsState(normalizedSeconds);
  }, [cancelCrossfade]);

  const maybeStartCrossfade = useCallback((activeAudio: HTMLAudioElement) => {
    if (isAppleMobileWebKit(navigator)) return;
    if (activeAudio !== player.audioRef.current) return;
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
    incomingAudio.src = onlineAudioUrl(
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
          || player.audioRef.current !== activeAudio
        ) {
          cancelCrossfade();
          return;
        }

        startingTrackIdRef.current = null;
        incomingTrackIdRef.current = candidate.trackId;

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
  }, [cancelCrossfade, clearAudio, crossfadeSeconds, getInactiveAudio, player.audioRef, player.current?.id, player.currentIndex, player.normalizationMode, player.playing, player.queue, player.repeatMode, player.streamingMode]);

  const handleDeckEnded = useCallback((audio: HTMLAudioElement) => {
    if (audio !== player.audioRef.current) {
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

    attemptRef.current += 1;
    cancelAnimation();
    originTrackIdRef.current = null;
    startingTrackIdRef.current = null;
    incomingTrackIdRef.current = null;

    activeDeckRef.current = activeDeckRef.current === 'a' ? 'b' : 'a';
    incomingAudio.volume = outputVolumeRef.current;
    player.audioRef.current = incomingAudio;
    markAdoptedAudioTrack(incomingAudio, candidate.trackId);
    player.audioHandlers.onPlay();
    player.audioHandlers.onEnded();
    clearAudio(audio);
  }, [cancelAnimation, cancelCrossfade, clearAudio, crossfadeSeconds, getInactiveAudio, player.audioHandlers, player.audioRef, player.current?.id, player.currentIndex, player.queue, player.repeatMode]);

  const handleDeckError = useCallback((audio: HTMLAudioElement) => {
    if (audio === player.audioRef.current) {
      cancelCrossfade();
      player.audioHandlers.onError(audio);
      return;
    }

    if (startingTrackIdRef.current || incomingTrackIdRef.current) cancelCrossfade();
  }, [cancelCrossfade, player.audioHandlers, player.audioRef]);

  const handleDeckPause = useCallback((audio: HTMLAudioElement) => {
    if (audio === player.audioRef.current) {
      player.audioHandlers.onPause();
      return;
    }
    if (startingTrackIdRef.current || incomingTrackIdRef.current) cancelCrossfade();
  }, [cancelCrossfade, player.audioHandlers, player.audioRef]);

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
        if (audio === player.audioRef.current) player.audioHandlers.onPlay();
      },
      onPause: handleDeckPause,
      onTimeUpdate: (audio: HTMLAudioElement) => {
        if (audio !== player.audioRef.current) return;
        player.audioHandlers.onTimeUpdate(audio);
        maybeStartCrossfade(audio);
      },
      onLoadedMetadata: (audio: HTMLAudioElement) => {
        if (audio === player.audioRef.current) player.audioHandlers.onLoadedMetadata(audio);
      },
      onEnded: handleDeckEnded,
      onError: handleDeckError
    }
  };
}
