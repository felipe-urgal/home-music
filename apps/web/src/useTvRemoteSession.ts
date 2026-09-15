import { createTvRemoteStatusPublisher } from './tv-remote-status-publisher';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  onSetCrossfadeSeconds: (seconds: number) => void;
  onTogglePlay: () => void | Promise<void>;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
};

export function useTvRemoteSession(options: UseTvRemoteSessionOptions) {
  const latestRef = useRef(options);
  useLayoutEffect(() => { latestRef.current = options; });
  const creationGenerationRef = useRef(0);
  const activeSessionRef = useRef<string | null>(null);
  const publishChangedRef = useRef<(() => void) | null>(null);
  const [crossfadeCapable, setCrossfadeCapable] = useState(false);
  const appliedIdRef = useRef(0);
  const [appliedId, setAppliedId] = useState(0);
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
      ...(crossfadeCapable ? { crossfadeSeconds: latestRef.current.crossfadeSeconds, lastAppliedCrossfadeCommandId: appliedId } : {})
    };
  }, [crossfadeCapable, appliedId]);

  const playbackStateRef = useRef(playbackState);
  useLayoutEffect(() => { playbackStateRef.current = playbackState; });

  const disposeSession = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await closeTvRemoteSession(id);
    } catch {
      // Expired/already closed sessions need no further cleanup.
    }
  }, []);

  const createFreshSession = useCallback(async (showPairing: boolean) => {
    const generation = ++creationGenerationRef.current;
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
      if (generation !== creationGenerationRef.current) { await disposeSession(session.id); return; }
      appliedIdRef.current = 0;
      setAppliedId(0);
      setCrossfadeCapable(session.capabilities?.crossfadeControl === true);
      activeSessionRef.current = session.id;
      setSessionId(session.id);
      setPairingUrl(`${window.location.origin}${remoteSessionPath(session.id)}`);
      setState('waiting');
    } catch (cause) {
      if (generation !== creationGenerationRef.current) return;
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
    const publisher = createTvRemoteStatusPublisher(
      () => tvRemoteSnapshot(playbackStateRef.current()),
      snapshot => publishTvRemoteStatus(sessionId, snapshot),
      cause => setError(cause instanceof Error ? cause.message : 'Falha ao atualizar o controle remoto.')
    );
    const scheduleChanged = () => publisher.request();
    publishChangedRef.current = scheduleChanged;

    const markConnected = () => {
      setState('connected');
      setOpen(false);
    };

    const stopEvents = openTvRemoteEvents(sessionId, {
      onRemoteConnected: markConnected,
      onCommand: (command, eventId) => {
        markConnected();
        if (command.type === 'set-crossfade') {
          if (!crossfadeCapable || eventId <= appliedIdRef.current) return;
          latestRef.current.onSetCrossfadeSeconds(command.seconds);
          appliedIdRef.current = eventId;
          setAppliedId(eventId);
          return;
        }
        const current = playbackStateRef.current();
        const controls = latestRef.current;
        applyTvRemotePlayerCommand(command, current, {
          togglePlay: controls.onTogglePlay,
          previous: controls.onPrevious,
          next: controls.onNext,
          seek: controls.onSeek,
          toggleShuffle: controls.onToggleShuffle,
          cycleRepeatMode: controls.onCycleRepeat,
          playTrack: requestTvRemoteTrack,
          setCrossfade: controls.onSetCrossfadeSeconds
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

    publisher.request(true);
    const heartbeat = window.setInterval(() => { publisher.request(true); }, 15_000);

    return () => {
      publisher.stop();
      publishChangedRef.current = null;
      stopEvents();
      window.clearInterval(heartbeat);
    };
  }, [crossfadeCapable, sessionId]);

  useEffect(() => {
    publishChangedRef.current?.();
  }, [options.current?.id, options.current?.title, options.current?.artist, options.current?.albumArtist,
    options.playing, options.currentTime, options.duration, options.shuffle, options.repeatMode, options.crossfadeSeconds, appliedId]);

  useEffect(() => () => {
    creationGenerationRef.current += 1;
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
