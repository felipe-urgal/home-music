import { useCallback, useEffect, useRef, useState } from 'react';
import { hasTvRemoteCrossfadePair, type TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import { sendTvRemoteCrossfade } from './tv-remote-client';

type Intent = { seconds: number; id?: number; controller: AbortController; timer: number };

export function crossfadeConfirmation(snapshot: TvRemotePlaybackSnapshot | null, id: number, seconds: number): string | null {
  if (!snapshot || !hasTvRemoteCrossfadePair(snapshot) || snapshot.lastAppliedCrossfadeCommandId < id) return null;
  if (snapshot.lastAppliedCrossfadeCommandId > id) return 'Outra alteração de Crossfade prevaleceu. Confira o valor atual.';
  return snapshot.crossfadeSeconds === seconds
    ? `Crossfade: ${seconds} s`
    : 'O valor do Crossfade já foi alterado. Confira o valor atual.';
}

export function useRemoteCrossfade(sessionId: string, snapshot: TvRemotePlaybackSnapshot | null, enabled: boolean) {
  const intentRef = useRef<Intent | null>(null);
  const latestRef = useRef(snapshot);
  latestRef.current = snapshot;
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const finish = useCallback((message: string | null) => {
    const intent = intentRef.current;
    intentRef.current = null;
    if (intent) { window.clearTimeout(intent.timer); intent.controller.abort(); }
    setPending(null);
    setMessage(message);
  }, []);
  const reconcile = useCallback(() => {
    const intent = intentRef.current;
    if (!intent || intent.id === undefined) return;
    const result = crossfadeConfirmation(latestRef.current, intent.id, intent.seconds);
    if (result) finish(result);
  }, [finish]);
  useEffect(reconcile, [snapshot, reconcile]);
  useEffect(() => { if (!enabled) finish(null); }, [enabled, finish]);
  useEffect(() => {
    finish(null);
    return () => {
      const intent = intentRef.current;
      intentRef.current = null;
      if (intent) { window.clearTimeout(intent.timer); intent.controller.abort(); }
    };
  }, [sessionId, finish]);

  const choose = useCallback(async (seconds: number) => {
    if (!enabled || intentRef.current || latestRef.current?.crossfadeSeconds === seconds) return;
    const intent: Intent = { seconds, controller: new AbortController(), timer: 0 };
    intentRef.current = intent;
    intent.timer = window.setTimeout(() => {
      if (intentRef.current === intent) finish('A TV não confirmou a alteração. Confira o valor e tente novamente.');
    }, 10_000);
    setPending(seconds);
    setMessage(null);
    try {
      const id = await sendTvRemoteCrossfade(sessionId, seconds, intent.controller.signal);
      if (intentRef.current !== intent) return;
      intent.id = id;
      reconcile();
    } catch {
      if (intentRef.current === intent) finish('Não foi possível alterar o Crossfade. Tente novamente.');
    }
  }, [enabled, finish, reconcile, sessionId]);
  return { pending, message, choose };
}
