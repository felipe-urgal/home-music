import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepeatMode, Track } from '@home-music/shared';
import { remoteSessionPath } from './browser-navigation';
import { isTvMode } from './tv-mode';
import {
  closeTvRemoteSession,
  createTvRemoteSession,
  openTvRemoteEvents,
  publishTvRemoteStatus,
  type TvRemoteTransportStatus
} from './tv-remote-client';
import {
  applyTvRemotePlayerCommand,
  tvRemoteSnapshot,
  tvRemoteSnapshotKey,
  type TvRemotePlaybackState
} from './tv-remote-tv-controller';
import { requestTvRemoteTrack } from './tv-remote-track-request';

type TvRemoteSessionState = 'idle' | 'creating' | 'waiting' | 'connected' | 'error' | 'closed';

type UseTvRemoteSessionOptions = {
  current?: Track;
  playing: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  crossfadeSeconds: number;
  onTogglePlay: () => void | Promise<void>;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onCrossfadeSeconds: (seconds: number) => void;
};

export function useTvRemoteSession(options: UseTvRemoteSessionOptions) {
  const latestRef = useRef(options);
  latestRef.current = options;
  const activeSessionRef = useRef<string | null>(null);
  const publishChangedRef = useRef<(() => void) | null>(null);
  const lastAppliedCrossfadeCommandIdRef = useRef(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [state, setState] = useState<TvRemoteSessionState>('idle');
  const [transport, setTransport] = useState<TvRemoteTransportStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const playbackState = useCallback((): TvRemotePlaybackState => {
    const current = latestRef.current.current;
    return {
      trackId: current?.id ?? null,
      title: current?.title ?? null,
      artist: current?.albumArtist || current?.artist || null,
      playing: latestRef.current.playing,
      currentTime: latestRef.current.currentTime,
      duration: latestRef.current.duration,
      shuffle: latestRef.current.shuffle,
      repeatMode: latestRef.current.repeatMode,
      crossfadeSeconds: latestRef.current.crossfadeSeconds,
      lastAppliedCrossfadeCommandId: lastAppliedCrossfadeCommandIdRef.current
    };
  }, []);

  const disposeSession = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await closeTvRemoteSession(id);
    } catch {
      // Expired/already closed sessions need no further cleanup.
    }
  }, []);

  const createFreshSession = useCallback(async (showPairing: boolean) => {
    const previous = activeSessionRef.current;
    activeSessionRef.current = null;
    setSessionId(null);
    setPairingUrl(null);
    setOpen(showPairing);
    setState('creating');
    setTransport('connecting');
    setError(null);
    if (previous) await disposeSession(previous);

    try {
      const session = await createTvRemoteSession();
      activeSessionRef.current = session.id;
      setSessionId(session.id);
      setPairingUrl(`${window.location.origin}${remoteSessionPath(session.id)}`);
      setState('waiting');
    } catch (cause) {
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o controle remoto.');
    }
  }, [disposeSession]);

  const closePairing = useCallback(() => {
    setOpen(false);
  }, []);

  const openPairing = useCallback(async () => {
    setOpen(true);
    if (state === 'creating' || (activeSessionRef.current && pairingUrl)) return;
    await createFreshSession(true);
  }, [createFreshSession, pairingUrl, state]);

  const regenerate = useCallback(async () => {
    await createFreshSession(true);
  }, [createFreshSession]);

  useEffect(() => {
    if (!isTvMode() || state !== 'idle' || activeSessionRef.current) return;
    void createFreshSession(false);
  }, [createFreshSession, state]);

  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let timer: number | null = null;
    let lastPublishedAt = 0;
    let lastKey = '';

    const publish = async (force: boolean) => {
      if (stopped) return;
      const snapshot = tvRemoteSnapshot(playbackState());
      const key = tvRemoteSnapshotKey(snapshot);
      if (!force && key === lastKey) return;
      try {
        await publishTvRemoteStatus(sessionId, snapshot);
        if (stopped) return;
        lastPublishedAt = Date.now();
        lastKey = key;
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : 'Falha ao atualizar o controle remoto.');
      }
    };

    const scheduleChanged = () => {
      if (stopped || timer !== null) return;
      const delay = Math.max(0, 1000 - (Date.now() - lastPublishedAt));
      timer = window.setTimeout(() => {
        timer = null;
        void publish(false);
      }, delay);
    };
    publishChangedRef.current = scheduleChanged;

    const markConnected = () => {
      setState('connected');
      setOpen(false);
    };

    const stopEvents = openTvRemoteEvents(sessionId, {
      onRemoteConnected: markConnected,
      onCommand: (command, eventId) => {
        markConnected();
        const current = playbackState();
        const controls = latestRef.current;
        if (command.type === 'set-crossfade') {
          lastAppliedCrossfadeCommandIdRef.current = eventId;
        }
        applyTvRemotePlayerCommand(command, current, {
          togglePlay: controls.onTogglePlay,
          previous: controls.onPrevious,
          next: controls.onNext,
          seek: controls.onSeek,
          toggleShuffle: controls.onToggleShuffle,
          cycleRepeatMode: controls.onCycleRepeat,
          playTrack: requestTvRemoteTrack,
          setCrossfade: controls.onCrossfadeSeconds
        });
        scheduleChanged();
      },
      onClosed: () => {
        activeSessionRef.current = null;
        setOpen(false);
        setState('closed');
        setSessionId(null);
        setPairingUrl(null);
      },
      onTransportStatus: setTransport,
      onError: () => setError('O controle remoto recebeu um evento inválido.')
    });

    void publish(true);
    const heartbeat = window.setInterval(() => { void publish(true); }, 15_000);

    return () => {
      stopped = true;
      publishChangedRef.current = null;
      stopEvents();
      window.clearInterval(heartbeat);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [playbackState, sessionId]);

  useEffect(() => {
    publishChangedRef.current?.();
  }, [options.current?.id, options.current?.title, options.current?.artist, options.current?.albumArtist,
    options.playing, options.currentTime, options.duration, options.shuffle, options.repeatMode, options.crossfadeSeconds]);

  useEffect(() => () => {
    const id = activeSessionRef.current;
    activeSessionRef.current = null;
    void disposeSession(id);
  }, [disposeSession]);

  return {
    open,
    state,
    transport,
    sessionId,
    pairingUrl,
    error,
    openPairing,
    closePairing,
    regenerate
  };
}
