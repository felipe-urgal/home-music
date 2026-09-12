import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { remoteSessionPath } from './browser-navigation';
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

type TvRemoteSessionState = 'idle' | 'creating' | 'waiting' | 'connected' | 'error' | 'closed';

type UseTvRemoteSessionOptions = {
  current?: Track;
  playing: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void | Promise<void>;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
};

export function useTvRemoteSession(options: UseTvRemoteSessionOptions) {
  const latestRef = useRef(options);
  latestRef.current = options;
  const activeSessionRef = useRef<string | null>(null);
  const publishChangedRef = useRef<(() => void) | null>(null);
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
      duration: latestRef.current.duration
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

  const createFreshSession = useCallback(async () => {
    const previous = activeSessionRef.current;
    activeSessionRef.current = null;
    setSessionId(null);
    setPairingUrl(null);
    setOpen(true);
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
    // Closing the QR overlay must not revoke an already paired phone. The
    // active session remains owned by this TV until regeneration/unmount.
    setOpen(false);
  }, []);

  const openPairing = useCallback(async () => {
    setOpen(true);
    if (activeSessionRef.current && pairingUrl) return;
    await createFreshSession();
  }, [createFreshSession, pairingUrl]);

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

    const stopEvents = openTvRemoteEvents(sessionId, {
      onCommand: command => {
        setState('connected');
        const current = playbackState();
        const controls = latestRef.current;
        applyTvRemotePlayerCommand(command, current, {
          togglePlay: controls.onTogglePlay,
          previous: controls.onPrevious,
          next: controls.onNext,
          seek: controls.onSeek
        });
        scheduleChanged();
      },
      onClosed: () => {
        activeSessionRef.current = null;
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
    options.playing, options.currentTime, options.duration]);

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
    regenerate: createFreshSession
  };
}
