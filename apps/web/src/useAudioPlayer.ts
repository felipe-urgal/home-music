import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NormalizationMode, PlaybackState, RepeatMode, Track } from '@home-music/shared';
import { apiFetch } from './api-client';
import { buildQueueContext } from './library-utils';
import { offlineAudioUrl } from './offline-downloads';
import {
  nextTrackAfterErrorDecision,
  nextTrackDecision,
  remapQueue,
  resolveOutputVolume,
  restorePlayerState
} from './player-state';
import {
  effectiveNormalizationMode as resolveEffectiveNormalizationMode,
  onlineAudioUrl,
  readNormalizationMode,
  readStreamingMode,
  shouldFallbackToOriginal,
  shouldRetryWithCompatibilityTranscode,
  type StreamingMode,
  writeNormalizationMode,
  writeStreamingMode
} from './streaming-quality';

const OFFLINE_PLAYER_STATE_KEY = 'home-music:offline-player:v1';
const EMPTY_STATE: PlaybackState = {
  currentTrackId: null,
  position: 0,
  volume: 1,
  shuffle: false,
  repeatMode: 'off',
  wasPlaying: false,
  baseQueueIds: [],
  queueIds: [],
  updatedAt: new Date(0).toISOString()
};

type AudioPlayerOptions = {
  offlineMode?: boolean;
};

function mutationFetch(url: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set('X-Home-Music-Request', '1');
  return apiFetch(url, { ...init, headers });
}

function isRepeatMode(value: unknown): value is RepeatMode {
  return value === 'off' || value === 'all' || value === 'one';
}

function initialStreamingMode(): StreamingMode {
  try {
    return readStreamingMode(window.localStorage);
  } catch {
    return 'auto';
  }
}

function initialNormalizationMode(): NormalizationMode {
  try {
    return readNormalizationMode(window.localStorage);
  } catch {
    return 'off';
  }
}

function persistNormalizationMode(mode: NormalizationMode) {
  try {
    writeNormalizationMode(window.localStorage, mode);
  } catch {
    // Preferência é local e best-effort.
  }
}

function persistStreamingMode(mode: StreamingMode) {
  try {
    writeStreamingMode(window.localStorage, mode);
  } catch {
    // Preferência é local e best-effort.
  }
}

function readOfflinePlayerState(): PlaybackState {
  try {
    const value = JSON.parse(window.localStorage.getItem(OFFLINE_PLAYER_STATE_KEY) || '{}') as Partial<PlaybackState>;
    return {
      currentTrackId: typeof value.currentTrackId === 'string' ? value.currentTrackId : null,
      position: typeof value.position === 'number' && Number.isFinite(value.position) && value.position >= 0 ? value.position : 0,
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : 1,
      shuffle: Boolean(value.shuffle),
      repeatMode: isRepeatMode(value.repeatMode) ? value.repeatMode : 'off',
      wasPlaying: false,
      baseQueueIds: Array.isArray(value.baseQueueIds) ? value.baseQueueIds.filter((id): id is string => typeof id === 'string') : [],
      queueIds: Array.isArray(value.queueIds) ? value.queueIds.filter((id): id is string => typeof id === 'string') : [],
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString()
    };
  } catch {
    return EMPTY_STATE;
  }
}

function writeOfflinePlayerState(state: Omit<PlaybackState, 'updatedAt'>) {
  try {
    window.localStorage.setItem(OFFLINE_PLAYER_STATE_KEY, JSON.stringify({
      ...state,
      updatedAt: new Date().toISOString()
    }));
  } catch {
    // Persistência offline é best-effort; reprodução continua funcionando sem ela.
  }
}

function shuffledAroundCurrent(tracks: Track[], currentId: string) {
  const others = tracks.filter(track => track.id !== currentId);
  for (let index = others.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [others[index], others[swapWith]] = [others[swapWith], others[index]];
  }
  const current = tracks.find(track => track.id === currentId);
  return current ? [current, ...others] : others;
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function useAudioPlayer(
  tracks: Track[],
  progressVisible: boolean,
  libraryReady: boolean,
  usesSystemVolume: boolean,
  options: AudioPlayerOptions = {}
) {
  const offlineMode = Boolean(options.offlineMode);
  const audioRef = useRef<HTMLAudioElement>(null);
  const positionRef = useRef(0);
  const restoredPositionRef = useRef(0);
  const sourceTrackRef = useRef<string | null>(null);
  const sourceFallbackRef = useRef<'none' | 'compatibility' | 'original' | 'unnormalized'>('none');
  const failedPlaybackTrackIdsRef = useRef(new Set<string>());
  const hydratedRef = useRef(false);
  const resumeIntentRef = useRef(false);
  const [orderedQueue, setOrderedQueue] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [resumeIntent, setResumeIntent] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [streamingMode, setStreamingModeState] = useState<StreamingMode>(() => offlineMode ? 'original' : initialStreamingMode());
  const [normalizationMode, setNormalizationModeState] = useState<NormalizationMode>(() => offlineMode ? 'off' : initialNormalizationMode());
  const [hydrated, setHydrated] = useState(false);

  const trackMap = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const currentIndex = currentTrackId ? queue.findIndex(track => track.id === currentTrackId) : -1;
  const current = currentTrackId ? trackMap.get(currentTrackId) : undefined;
  const effectiveNormalizationMode = current ? resolveEffectiveNormalizationMode(current, normalizationMode) : 'off';
  const hasNext = currentIndex >= 0 && (
    currentIndex < queue.length - 1 || repeatMode === 'all'
  );

  const setPlaybackIntent = useCallback((value: boolean) => {
    resumeIntentRef.current = value;
    setResumeIntent(value);
  }, []);

  const handlePlayRejection = useCallback((error: unknown) => {
    setPlaying(false);
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      setPlaybackIntent(false);
      setAutoplayBlocked(true);
    }
  }, [setPlaybackIntent]);

  const resumeAudio = useCallback((audio: HTMLAudioElement) => {
    if (!resumeIntentRef.current) return;
    audio.play()
      .then(() => {
        setPlaying(true);
        setAutoplayBlocked(false);
      })
      .catch(handlePlayRejection);
  }, [handlePlayRejection]);

  useEffect(() => {
    if (!libraryReady || hydratedRef.current) return;
    hydratedRef.current = true;

    const statePromise = offlineMode
      ? Promise.resolve(readOfflinePlayerState())
      : apiFetch('/api/player/state')
          .then(response => response.ok ? response.json() as Promise<PlaybackState> : EMPTY_STATE)
          .catch(() => EMPTY_STATE);

    statePromise
      .then(state => {
        const restored = restorePlayerState(tracks, {
          ...EMPTY_STATE,
          ...state,
          baseQueueIds: Array.isArray(state.baseQueueIds) ? state.baseQueueIds : []
        });
        const shouldResume = Boolean(!offlineMode && state.wasPlaying && restored.currentTrackId);

        setOrderedQueue(restored.baseQueue);
        setQueue(restored.queue);
        setCurrentTrackId(restored.currentTrackId);
        setVolumeState(state.volume);
        setShuffle(state.shuffle);
        setRepeatMode(state.repeatMode);
        setPlaybackIntent(shouldResume);
        setAutoplayBlocked(false);
        restoredPositionRef.current = restored.position;
        positionRef.current = restored.position;
        setCurrentTime(restored.position);
      })
      .catch(() => {
        setOrderedQueue(tracks);
        setQueue(tracks);
        setCurrentTrackId(tracks[0]?.id ?? null);
        setPlaybackIntent(false);
        setAutoplayBlocked(false);
        restoredPositionRef.current = 0;
        positionRef.current = 0;
        setCurrentTime(0);
      })
      .finally(() => setHydrated(true));
  }, [libraryReady, offlineMode, setPlaybackIntent, tracks]);

  useEffect(() => {
    if (!hydrated) return;
    const audio = audioRef.current;

    if (!tracks.length) {
      audio?.pause();
      if (audio) {
        audio.removeAttribute('src');
        audio.load();
      }
      setOrderedQueue([]);
      setQueue([]);
      setCurrentTrackId(null);
      setPlaying(false);
      setPlaybackIntent(false);
      setAutoplayBlocked(false);
      setSourceError(null);
      setCurrentTime(0);
      setDuration(0);
      positionRef.current = 0;
      restoredPositionRef.current = 0;
      sourceTrackRef.current = null;
      sourceFallbackRef.current = 'none';
      failedPlaybackTrackIdsRef.current.clear();
      return;
    }

    setOrderedQueue(items => {
      const refreshed = remapQueue(items, trackMap);
      return refreshed.length ? refreshed : tracks;
    });
    setQueue(items => {
      const refreshed = remapQueue(items, trackMap);
      return refreshed.length ? refreshed : tracks;
    });

    if (!currentTrackId || !trackMap.has(currentTrackId)) {
      setCurrentTrackId(tracks[0].id);
      setPlaybackIntent(false);
      restoredPositionRef.current = 0;
      positionRef.current = 0;
      setCurrentTime(0);
    }
  }, [tracks, trackMap, hydrated, currentTrackId, setPlaybackIntent]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current || !hydrated) return;

    if (sourceTrackRef.current !== current.id) {
      sourceTrackRef.current = current.id;
    }
    sourceFallbackRef.current = 'none';
    setSourceError(null);
    setCurrentTime(0);
    setDuration(current.duration ?? 0);
    positionRef.current = 0;
    audio.src = offlineMode
      ? offlineAudioUrl(current.id)
      : onlineAudioUrl(current.id, streamingMode, false, effectiveNormalizationMode);
    audio.load();
    resumeAudio(audio);
  }, [current?.id, effectiveNormalizationMode, hydrated, offlineMode, resumeAudio, streamingMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = resolveOutputVolume(volume, usesSystemVolume);
  }, [usesSystemVolume, volume]);

  const persistState = useCallback(() => {
    if (!hydrated) return;
    const body = {
      currentTrackId: current?.id ?? null,
      position: positionRef.current,
      volume,
      shuffle,
      repeatMode,
      wasPlaying: resumeIntent,
      baseQueueIds: orderedQueue.map(track => track.id),
      queueIds: queue.map(track => track.id)
    };

    if (offlineMode) {
      writeOfflinePlayerState(body);
      return;
    }

    mutationFetch('/api/player/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(() => undefined);
  }, [current?.id, hydrated, offlineMode, orderedQueue, queue, repeatMode, resumeIntent, shuffle, volume]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(persistState, 450);
    return () => window.clearTimeout(timeout);
  }, [persistState, hydrated]);

  useEffect(() => {
    if (!hydrated || !playing) return;
    const interval = window.setInterval(persistState, 5000);
    return () => window.clearInterval(interval);
  }, [hydrated, persistState, playing]);

  useEffect(() => {
    const save = () => persistState();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', save);
    };
  }, [persistState]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    failedPlaybackTrackIdsRef.current.clear();
    setPlaybackIntent(true);
    setAutoplayBlocked(false);
    setSourceError(null);
    try {
      await audio.play();
      setPlaying(true);
    } catch (error) {
      handlePlayRejection(error);
    }
  }, [current, handlePlayRejection, setPlaybackIntent]);

  const pause = useCallback(() => {
    setPlaybackIntent(false);
    audioRef.current?.pause();
    setPlaying(false);
  }, [setPlaybackIntent]);

  const togglePlay = useCallback(() => {
    if (audioRef.current?.paused) return play();
    pause();
    return Promise.resolve();
  }, [pause, play]);

  const restartCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    failedPlaybackTrackIdsRef.current.clear();
    audio.currentTime = 0;
    positionRef.current = 0;
    setCurrentTime(0);
    setPlaybackIntent(true);
    setAutoplayBlocked(false);
    audio.play().catch(handlePlayRejection);
  }, [handlePlayRejection, setPlaybackIntent]);

  const next = useCallback((fromEnded = false) => {
    if (!fromEnded) failedPlaybackTrackIdsRef.current.clear();
    const decision = nextTrackDecision(queue, currentIndex, repeatMode, fromEnded);

    if (decision.type === 'restart') {
      restartCurrent();
      return;
    }
    if (decision.type === 'track') {
      setCurrentTrackId(decision.id);
      return;
    }
    setPlaybackIntent(false);
    setPlaying(false);
  }, [currentIndex, queue, repeatMode, restartCurrent, setPlaybackIntent]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !queue.length || currentIndex < 0) return;
    failedPlaybackTrackIdsRef.current.clear();

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      positionRef.current = 0;
      setCurrentTime(0);
      return;
    }

    if (currentIndex > 0) {
      setCurrentTrackId(queue[currentIndex - 1].id);
      return;
    }

    if (repeatMode === 'all' && queue.length > 1) {
      setCurrentTrackId(queue[queue.length - 1].id);
      return;
    }

    audio.currentTime = 0;
    positionRef.current = 0;
    setCurrentTime(0);
  }, [currentIndex, queue, repeatMode]);

  const seek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextValue = Math.max(0, Math.min(value, Number.isFinite(audio.duration) ? audio.duration : value));
    audio.currentTime = nextValue;
    positionRef.current = nextValue;
    setCurrentTime(nextValue);
  }, []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(Math.max(0, Math.min(1, value)));
  }, []);

  const setStreamingMode = useCallback((mode: StreamingMode) => {
    if (offlineMode || mode === streamingMode) return;
    restoredPositionRef.current = positionRef.current;
    persistStreamingMode(mode);
    setStreamingModeState(mode);
  }, [offlineMode, streamingMode]);

  const setNormalizationMode = useCallback((mode: NormalizationMode) => {
    if (offlineMode || mode === normalizationMode) return;
    restoredPositionRef.current = positionRef.current;
    persistNormalizationMode(mode);
    setNormalizationModeState(mode);
  }, [normalizationMode, offlineMode]);

  const playTrack = useCallback((track: Track, contextTracks: Track[]) => {
    const context = buildQueueContext(track, contextTracks);
    const baseQueue = context.queue;
    const playbackQueue = shuffle ? shuffledAroundCurrent(baseQueue, track.id) : baseQueue;
    const sameTrack = current?.id === track.id;

    failedPlaybackTrackIdsRef.current.clear();
    setOrderedQueue(baseQueue);
    setQueue(playbackQueue);
    setCurrentTrackId(track.id);
    setPlaybackIntent(true);
    setAutoplayBlocked(false);
    setSourceError(null);

    if (sameTrack) {
      audioRef.current?.play().catch(handlePlayRejection);
    }
  }, [current?.id, handlePlayRejection, setPlaybackIntent, shuffle]);

  const toggleShuffle = useCallback(() => {
    if (!current) return;

    setShuffle(value => {
      const nextValue = !value;
      if (nextValue) {
        setQueue(shuffledAroundCurrent(orderedQueue.length ? orderedQueue : queue, current.id));
      } else {
        setQueue(orderedQueue.length ? orderedQueue : queue);
      }
      return nextValue;
    });
  }, [current, orderedQueue, queue]);

  const cycleRepeat = useCallback(() => {
    setRepeatMode(mode => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off');
  }, []);

  const reorderQueue = useCallback((from: number, to: number) => {
    if (!current || from === to) return;
    setShuffle(false);
    setQueue(items => {
      const nextQueue = moveItem(items, from, to);
      setOrderedQueue(nextQueue);
      return nextQueue;
    });
  }, [current]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current || typeof MediaMetadata === 'undefined') return;

    const artwork = !offlineMode && current.hasCover ? [{ src: `/api/tracks/${current.id}/cover` }] : undefined;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork
    });

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => { void play(); }],
      ['pause', () => pause()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next(false)],
      ['seekbackward', details => seek(Math.max(0, positionRef.current - (details.seekOffset ?? 10)))],
      ['seekforward', details => seek(positionRef.current + (details.seekOffset ?? 10))],
      ['seekto', details => {
        if (typeof details.seekTime === 'number') seek(details.seekTime);
      }]
    ];

    for (const [action, handler] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* suporte varia por navegador */ }
    }

    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* noop */ }
      }
    };
  }, [current, next, offlineMode, pause, play, previous, seek]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  function handleLoadedMetadata(audio: HTMLAudioElement) {
    const loadedDuration = audio.duration || current?.duration || 0;
    setDuration(loadedDuration);
    setSourceError(null);
    const restored = restoredPositionRef.current;
    restoredPositionRef.current = 0;

    if (restored > 0 && restored < loadedDuration) {
      audio.currentTime = restored;
      positionRef.current = restored;
      setCurrentTime(restored);
    }
  }

  function handleTimeUpdate(audio: HTMLAudioElement) {
    positionRef.current = audio.currentTime;
    if (progressVisible) setCurrentTime(audio.currentTime);

    if ('mediaSession' in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: Math.min(audio.currentTime, audio.duration)
        });
      } catch {
        // Alguns browsers implementam Media Session parcialmente.
      }
    }
  }

  function handlePlay() {
    failedPlaybackTrackIdsRef.current.clear();
    setPlaybackIntent(true);
    setAutoplayBlocked(false);
    setSourceError(null);
    setPlaying(true);
  }

  function handlePause() {
    setPlaying(false);
  }

  function handleError(audio: HTMLAudioElement) {
    const mediaErrorCode = audio.error?.code;

    if (!offlineMode && current && sourceFallbackRef.current === 'unnormalized') {
      if (shouldRetryWithCompatibilityTranscode(streamingMode, mediaErrorCode)) {
        sourceFallbackRef.current = 'compatibility';
        restoredPositionRef.current = positionRef.current;
        setSourceError(null);
        audio.src = onlineAudioUrl(current.id, streamingMode, true);
        audio.load();
        resumeAudio(audio);
        return;
      }

      if (shouldFallbackToOriginal(streamingMode, mediaErrorCode)) {
        sourceFallbackRef.current = 'original';
        restoredPositionRef.current = positionRef.current;
        setSourceError(null);
        audio.src = onlineAudioUrl(current.id, 'original');
        audio.load();
        resumeAudio(audio);
        return;
      }
    }

    if (!offlineMode && current && sourceFallbackRef.current === 'none') {
      if (effectiveNormalizationMode !== 'off') {
        sourceFallbackRef.current = 'unnormalized';
        restoredPositionRef.current = positionRef.current;
        setSourceError(null);
        audio.src = onlineAudioUrl(current.id, streamingMode);
        audio.load();
        resumeAudio(audio);
        return;
      }

      if (shouldRetryWithCompatibilityTranscode(streamingMode, mediaErrorCode)) {
        sourceFallbackRef.current = 'compatibility';
        restoredPositionRef.current = positionRef.current;
        setSourceError(null);
        audio.src = onlineAudioUrl(current.id, streamingMode, true);
        audio.load();
        resumeAudio(audio);
        return;
      }

      if (shouldFallbackToOriginal(streamingMode, mediaErrorCode)) {
        sourceFallbackRef.current = 'original';
        restoredPositionRef.current = positionRef.current;
        setSourceError(null);
        audio.src = onlineAudioUrl(current.id, 'original');
        audio.load();
        resumeAudio(audio);
        return;
      }
    }

    // MEDIA_ERR_ABORTED indica troca/cancelamento da fonte, não uma faixa quebrada.
    if (mediaErrorCode === 1) return;

    const errorMessage = offlineMode
      ? 'Este download não está mais disponível no dispositivo. Remova-o e baixe novamente quando estiver online.'
      : 'Não foi possível carregar esta música.';

    if (resumeIntentRef.current && current) {
      failedPlaybackTrackIdsRef.current.add(current.id);
      const decision = nextTrackAfterErrorDecision(
        queue,
        currentIndex,
        repeatMode,
        failedPlaybackTrackIdsRef.current
      );

      if (decision.type === 'track') {
        restoredPositionRef.current = 0;
        positionRef.current = 0;
        setCurrentTime(0);
        setDuration(0);
        setPlaying(false);
        setSourceError(null);
        setCurrentTrackId(decision.id);
        return;
      }
    }

    failedPlaybackTrackIdsRef.current.clear();
    setPlaying(false);
    setPlaybackIntent(false);
    setSourceError(errorMessage);
  }

  return {
    audioRef,
    current,
    queue,
    currentIndex,
    playing,
    autoplayBlocked,
    sourceError,
    currentTime,
    duration,
    volume,
    shuffle,
    repeatMode,
    streamingMode,
    normalizationMode,
    effectiveNormalizationMode,
    hasNext,
    hydrated,
    playTrack,
    togglePlay,
    next: () => next(false),
    previous,
    seek,
    setVolume,
    setStreamingMode,
    setNormalizationMode,
    toggleShuffle,
    cycleRepeat,
    reorderQueue,
    syncVisibleProgress: () => setCurrentTime(positionRef.current),
    audioHandlers: {
      onPlay: handlePlay,
      onPause: handlePause,
      onTimeUpdate: handleTimeUpdate,
      onLoadedMetadata: handleLoadedMetadata,
      onEnded: () => next(true),
      onError: handleError
    }
  };
}
