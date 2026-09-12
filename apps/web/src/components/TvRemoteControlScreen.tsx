import { useEffect, useMemo, useState } from 'react';
import type { LibraryResponse, Track, TvRemotePlaybackSnapshot } from '@home-music/shared';
import type { TvRemoteCommand } from '@home-music/shared/tv-remote';
import {
  LoaderCircle,
  Music2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Search,
  SkipBack,
  SkipForward,
  Tv
} from 'lucide-react';
import { apiFetch } from '../api-client';
import { filterTvRemoteTracks } from '../tv-remote-library-picker';
import {
  getTvRemoteSession,
  openTvRemoteEvents,
  sendTvRemoteCommand,
  type TvRemoteTransportStatus
} from '../tv-remote-client';

type RemoteState = 'loading' | 'ready' | 'missing' | 'closed' | 'error';
type LibraryState = 'loading' | 'ready' | 'error';

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

function trackArtist(track: Track) {
  return track.albumArtist || track.artist || 'Artista desconhecido';
}

export function TvRemoteControlScreen({ sessionId, username }: TvRemoteControlScreenProps) {
  const [state, setState] = useState<RemoteState>('loading');
  const [transport, setTransport] = useState<TvRemoteTransportStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TvRemotePlaybackSnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryState, setLibraryState] = useState<LibraryState>('loading');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [query, setQuery] = useState('');

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

  useEffect(() => {
    const controller = new AbortController();
    setLibraryState('loading');
    setLibraryError(null);

    void apiFetch('/api/library', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível carregar sua biblioteca.');
        return response.json() as Promise<LibraryResponse>;
      })
      .then(data => {
        setTracks(data.tracks);
        setLibraryState('ready');
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setLibraryState('error');
        setLibraryError(cause instanceof Error ? cause.message : 'Não foi possível carregar sua biblioteca.');
      });

    return () => controller.abort();
  }, []);

  const visibleTracks = useMemo(() => filterTvRemoteTracks(tracks, query), [query, tracks]);

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

  function chooseTrack(track: Track) {
    void send(`track:${track.id}`, { type: 'play-track', trackId: track.id });
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
          <p>{snapshot?.artist || 'Escolha uma música abaixo'}</p>
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

        <section className="tv-remote-picker" aria-labelledby="tv-remote-picker-title">
          <div className="tv-remote-picker__heading">
            <div>
              <small>Biblioteca</small>
              <h2 id="tv-remote-picker-title">Escolher música</h2>
            </div>
            {libraryState === 'ready' && <span>{tracks.length} faixas</span>}
          </div>

          <label className="tv-remote-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Buscar música, artista ou álbum</span>
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar música, artista ou álbum"
              autoComplete="off"
            />
          </label>

          {libraryState === 'loading' ? (
            <div className="tv-remote-picker__state" role="status"><LoaderCircle className="tv-remote-spin" aria-hidden="true" />Carregando biblioteca…</div>
          ) : libraryState === 'error' ? (
            <p className="tv-remote-picker__state tv-remote-picker__state--error" role="alert">{libraryError}</p>
          ) : visibleTracks.length === 0 ? (
            <p className="tv-remote-picker__state">Nenhuma faixa encontrada.</p>
          ) : (
            <div className="tv-remote-track-list" aria-label="Músicas da biblioteca">
              {visibleTracks.map(track => {
                const current = snapshot?.trackId === track.id;
                const sending = pending === `track:${track.id}`;
                return (
                  <button
                    className={`tv-remote-track${current ? ' tv-remote-track--current' : ''}`}
                    type="button"
                    key={track.id}
                    aria-label={`Tocar ${track.title} na TV`}
                    aria-current={current ? 'true' : undefined}
                    disabled={pending !== null}
                    onClick={() => chooseTrack(track)}
                  >
                    <span className="tv-remote-track__art" aria-hidden="true"><Music2 /></span>
                    <span className="tv-remote-track__copy">
                      <strong>{track.title}</strong>
                      <small>{trackArtist(track)}{track.album ? ` · ${track.album}` : ''}</small>
                    </span>
                    <span className="tv-remote-track__status">
                      {sending ? <><LoaderCircle className="tv-remote-spin" aria-hidden="true" />Enviando…</> : current ? 'Tocando' : <Play aria-hidden="true" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {error && <p className="tv-remote-card__error" role="alert">{error}</p>}
        <p className="tv-remote-card__hint">Toque em uma faixa para tocar direto na TV. O áudio continua somente nela.</p>
      </section>
    </main>
  );
}
