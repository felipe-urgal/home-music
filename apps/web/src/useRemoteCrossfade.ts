import { useCallback, useEffect, useRef, useState } from 'react';
import type { TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import {
  createRemoteCrossfadeController,
  type RemoteCrossfadeState
} from './remote-crossfade-controller';
import { sendTvRemoteCrossfade } from './tv-remote-client';

export { crossfadeConfirmation } from './remote-crossfade-controller';

export function useRemoteCrossfade(sessionId: string, snapshot: TvRemotePlaybackSnapshot | null, enabled: boolean) {
  const controllerRef = useRef<ReturnType<typeof createRemoteCrossfadeController> | null>(null);
  const [state, setState] = useState<RemoteCrossfadeState>({ pending: null, message: null });

  useEffect(() => {
    setState({ pending: null, message: null });
    const controller = createRemoteCrossfadeController(sessionId, {
      send: sendTvRemoteCrossfade,
      setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
      clearTimer: timer => window.clearTimeout(timer),
      onState: setState
    });
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
    };
  }, [sessionId]);

  useEffect(() => {
    controllerRef.current?.update(snapshot, enabled);
  }, [enabled, sessionId, snapshot]);

  const choose = useCallback(async (seconds: number) => {
    await controllerRef.current?.choose(seconds);
  }, []);

  return { ...state, choose };
}
