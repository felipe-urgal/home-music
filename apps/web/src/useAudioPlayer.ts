import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackState, RepeatMode, Track } from '@home-music/shared';
import { buildQueueContext } from './library-utils';

const EMPTY_STATE: PlaybackState = {
  currentTrackId: null,
  position: 0,
  volume: 1,
  shuffle: false,
  repeatMode: 'off',
  queueIds: [],
  updatedAt: new Date(0).toISOString()
};

function mutationFetch(url: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set('X-Home-Music-Request', '1');
  return fetch(url, { ...init, headers });
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

export function useAudioPlayer(tracks: Track[], progressVisible: boolean) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const positionRef = useRef(0);
  const restoredPositionRef = useRef(0);
  const historyTrackRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const [orderedQueue, setOrderedQueue] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [hydrated, setHydrated] = useState(false);

  const trackMap = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const currentIndex = currentTrackId ? queue.findIndex(track => track.id === currentTrackId) : -1;
  const current = currentTrackId ? trackMap.get(currentTrackId) ?? queue[currentIndex] : undefined;
  const hasNext = currentIndex >= 0 && (
    currentIndex < queue.length - 1 || repeatMode === 'all'
  );

  useEffect(() => {
    if (!tracks.length || hydratedRef.current) return;
    hydratedRef.current = true;

    fetch('/api/player/state')
      .then(response => response.ok ? response.json() as Promise<PlaybackState> : EMPTY_STATE)
      .then(state => {
        const restoredQueue = state.queueIds
          .map(id => trackMap.get(id))
          .filter((track): track is Track => Boolean(track));
        const initialQueue = restoredQueue.length ? restoredQueue : tracks;
        const restoredCurrent = state.currentTrackId && trackMap.has(state.currentTrackId)
          ? state.currentTrackId
          : initialQueue[0]?.id ?? null;

        setOrderedQueue(initialQueue);
        setQueue(initialQueue);
        setCurrentTrackId(restoredCurrent);
        setVolumeState(state.volume);
        setShuffle(state.shuffle);
        setRepeatMode(state.repeatMode);
        restoredPositionRef.current = state.position;
        positionRef.current = state.position;
        setCurrentTime(state.position);
      })
      .catch(() => {
        setOrderedQueue(tracks);
        setQueue(tracks);
        setCurrentTrackId(tracks[0]?.id ?? null);
      })
      .finally(() => setHydrated(true));
  }, [trackMap, tracks]);

  useEffect(() => {
    if (!hydrated || !tracks.length) return;

    const validIds = new Set(tracks.map(track => track.id));
    setOrderedQueue(items => items.filter(track => validIds.has(track.id)));
    setQueue(items => items.filter(track => validIds.has(track.id)));
    if (currentTrackId && !validIds.has(currentTrackId)) {
      setCurrentTrackId(tracks[0]?.id ?? null);
    }
  }, [tracks, hydrated, currentTrackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current || !hydrated) return;

    historyTrackRef.current = null;
    setCurrentTime(0);
    setDuration(current.duration ?? 0);
    positionRef.current = 0;
    audio.src = `/api/tracks/${current.id}/stream`;
    audio.load();

    if (playing) {
      audio.play().catch(() => setPlaying(false));
    }
  }, [current?.id, hydrated]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  const persistState = useCallback(() => {
    if (!hydrated) return;
    const body = {
      currentTrackId: current?.id ?? null,
      position: positionRef.current,
      volume,
      shuffle,
      repeatMode,
      queueIds: queue.map(track => track.id)
    };

    mutationFetch('/api/player/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(() => undefined);
  }, [current?.id, hydrated, queue, repeatMode, shuffle, volume]);

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
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [current]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    persistState();
  }, [persistState]);

  const togglePlay = useCallback(() => {
    if (audioRef.current?.paused) return play();
    pause();
    return Promise.resolve();
  }, [pause, play]);

  const next = useCallback((fromEnded = false) => {
    const audio = audioRef.current;
    if (!queue.length || currentIndex < 0) return;

    if (fromEnded && (repeatMode === 'one' || (repeatMode === 'all' && queue.length === 1)) && audio) {
      audio.currentTime = 0;
      positionRef.current = 0;
      setCurrentTime(0);
      audio.play().catch(() => setPlaying(false));
      return;
    }

    if (currentIndex < queue.length - 1) {
      setCurrentTrackId(queue[currentIndex + 1].id);
      return;
    }

    if (repeatMode === 'all' && queue.length > 1) {
      setCurrentTrackId(queue[0].id);
      return;
    }

    setPlaying(false);
  }, [currentIndex, queue, repeatMode]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !queue.length || currentIndex < 0) return;

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

  const playTrack = useCallback((track: Track, contextTracks: Track[]) => {
    const context = buildQueueContext(track, contextTracks);
    const baseQueue = context.queue;
    const playbackQueue = shuffle ? shuffledAroundCurrent(baseQueue, track.id) : baseQueue;
    const sameTrack = current?.id === track.id;

    setOrderedQueue(baseQueue);
    setQueue(playbackQueue);
    setCurrentTrackId(track.id);
    setPlaying(true);

    if (sameTrack) {
      audioRef.current?.play().catch(() => setPlaying(false));
    }
  }, [current?.id, shuffle]);

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
    if (!('mediaSession' in navigator) || !current) return;

    const artwork = current.hasCover ? [{ src: `/api/tracks/${current.id}/cover` }] : undefined;
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
  }, [current, next, pause, play, previous, seek]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  function handleLoadedMetadata(audio: HTMLAudioElement) {
    const loadedDuration = audio.duration || current?.duration || 0;
    setDuration(loadedDuration);
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
    setPlaying(true);
    if (current && historyTrackRef.current !== current.id) {
      historyTrackRef.current = current.id;
      mutationFetch(`/api/history/${current.id}`, { method: 'POST' }).catch(() => undefined);
    }
  }

  function handlePause() {
    setPlaying(false);
    persistState();
  }

  return {
    audioRef,
    current,
    queue,
    currentIndex,
    playing,
    currentTime,
    duration,
    volume,
    shuffle,
    repeatMode,
    hasNext,
    hydrated,
    playTrack,
    togglePlay,
    next: () => next(false),
    previous,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    reorderQueue,
    syncVisibleProgress: () => setCurrentTime(positionRef.current),
    audioHandlers: {
      onPlay: handlePlay,
      onPause: handlePause,
      onTimeUpdate: handleTimeUpdate,
      onLoadedMetadata: handleLoadedMetadata,
      onEnded: () => next(true)
    }
  };
}
