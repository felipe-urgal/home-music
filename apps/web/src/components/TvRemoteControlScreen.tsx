import { useEffect, useState } from 'react';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared';
import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Tv } from 'lucide-react';
import {
  getTvRemoteSession,
  openTvRemoteEvents,
  sendTvRemoteCommand,
  type TvRemoteTransportStatus
} from '../tv-remote-client';

type RemoteState = 'loading' | 'ready' | 'missing' | 'closed' | 'error';

type TvRemoteControlScreenProps = {
  sessionId: string;
  username: string;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function TvRemoteControlScreen({ sessionId, username }: TvRemoteControlScreenProps) {
  const [state, setState] = useState<RemoteState>('loading');
  const [transport, setTransport] = useState<TvRemoteTransportStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TvRemotePlaybackSnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let stopEvents: (() => void) | null = null;
    setState('loading');
    setError(null);
    setSnapshot(null);

    void getTvRemoteSession(sessionId).then(session => {
      if (disposed) return;
      setSnapshot(session.snapshot);
      setState('ready');
      stopEvents = openTvRemoteEvents(sessionId, {
        onSnapshot: next => setSnapshot(next),
        onClosed: () => setState('closed'),
        onTransportStatus: setTransport,
        onError: () => setError('A TV enviou uma atualização inválida.')
      });
    }).catch(cause => {
      if (disposed) return;
      const message = cause instanceof Error ? cause.message : 'Controle remoto indisponível.';
      setState(message.includes('não encontrado') ? 'missing' : 'error');
      setError(message);
    });

    return () => {
      disposed = true;
      stopEvents?.();
    };
  }, [sessionId]);

  async function send(key: string, command: TvRemoteCommand) {
    if (pending) return;
    setPending(key);
    setError(null);
    try {
      await sendTvRemoteCommand(sessionId, command);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível enviar o comando.';
      setError(message);
      if (message.includes('não encontrado')) setState('missing');
    } finally {
      setPending(null);
    }
  }

  if (state === 'loading') {
    return <main className="tv-remote-screen"><section className="tv-remote-card tv-remote-card--status" aria-live="polite"><Tv /><strong>Conectando à TV…</strong><span>Validando a sessão de {username}.</span></section></main>;
  }

  if (state === 'missing' || state === 'closed' || state === 'error') {
    const title = state === 'closed' ? 'Controle encerrado' : state === 'missing' ? 'Controle não encontrado' : 'Não foi possível conectar';
    return <main className="tv-remote-screen"><section className="tv-remote-card tv-remote-card--status"><Tv /><h1>{title}</h1><p>{error ?? 'Gere um novo código na TV e tente novamente.'}</p></section></main>;
  }

  const progress = snapshot && snapshot.duration > 0
    ? Math.max(0, Math.min(100, (snapshot.currentTime / snapshot.duration) * 100))
    : 0;
  const hasTrack = Boolean(snapshot?.trackId);
  const controlsDisabled = !hasTrack || pending !== null;
  const transportLabel = transport === 'open' ? 'Conectado' : transport === 'error' ? 'Reconectando…' : 'Conectando…';

  return (
    <main className="tv-remote-screen">
      <section className="tv-remote-card">
        <header className="tv-remote-card__header">
          <div><Tv aria-hidden="true" /><span><small>Home Music TV</small><strong>{transportLabel}</strong></span></div>
          <small>{username}</small>
        </header>

        <div className="tv-remote-now-playing" aria-live="polite">
          <small>Tocando agora</small>
          <h1>{snapshot?.title || 'Nenhuma música tocando'}</h1>
          <p>{snapshot?.artist || 'Escolha uma música na TV'}</p>
          <div className="tv-remote-progress" aria-label={snapshot ? `${formatTime(snapshot.currentTime)} de ${formatTime(snapshot.duration)}` : 'Sem progresso'}>
            <span><i style={{ width: `${progress}%` }} /></span>
            <div><small>{formatTime(snapshot?.currentTime ?? 0)}</small><small>{formatTime(snapshot?.duration ?? 0)}</small></div>
          </div>
        </div>

        <div className="tv-remote-controls" aria-label="Controles da TV" aria-busy={pending !== null}>
          <button type="button" aria-label="Voltar 10 segundos" disabled={controlsDisabled} onClick={() => void send('back', { type: 'seek', deltaSeconds: -10 })}><RotateCcw /><span>10s</span></button>
          <button type="button" aria-label="Faixa anterior" disabled={controlsDisabled} onClick={() => void send('previous', { type: 'previous' })}><SkipBack /></button>
          <button className="tv-remote-controls__primary" type="button" aria-label={snapshot?.playing ? 'Pausar' : 'Tocar'} disabled={controlsDisabled} onClick={() => void send('toggle', { type: 'toggle-play' })}>{snapshot?.playing ? <Pause /> : <Play />}</button>
          <button type="button" aria-label="Próxima faixa" disabled={controlsDisabled} onClick={() => void send('next', { type: 'next' })}><SkipForward /></button>
          <button type="button" aria-label="Avançar 10 segundos" disabled={controlsDisabled} onClick={() => void send('forward', { type: 'seek', deltaSeconds: 10 })}><RotateCw /><span>10s</span></button>
        </div>

        {error && <p className="tv-remote-card__error" role="alert">{error}</p>}
        <p className="tv-remote-card__hint">A reprodução acontece somente na TV. Este celular envia comandos para ela.</p>
      </section>
    </main>
  );
}
