import { useEffect, useMemo, useState } from 'react';
import type { TvRemotePlaybackSnapshot } from '@home-music/shared';
import type { TvRemoteCommand } from '@home-music/shared/tv-remote';
import { ListMusic, LoaderCircle, Pause, Play, RotateCcw, RotateCw, Search, SkipBack, SkipForward, Tv } from 'lucide-react';
import {
  getTvRemoteSession,
  openTvRemoteEvents,
  sendTvRemoteCommand,
  type TvRemoteTransportStatus
} from '../tv-remote-client';
import { useLibraryData } from '../useLibraryData';

type RemoteState = 'loading' | 'ready' | 'missing' | 'closed' | 'error';
type LibraryScope = 'all' | 'tracks' | 'artists' | 'albums' | 'playlists';

type TvRemoteControlScreenProps = {
  sessionId: string;
  username: string;
};

const scopes: Array<{ id: LibraryScope; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'tracks', label: 'Músicas' },
  { id: 'artists', label: 'Artistas' },
  { id: 'albums', label: 'Álbuns' },
  { id: 'playlists', label: 'Playlists' }
];

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function normalized(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function visibleMetadata(value: string | null | undefined, unknownLabel: string) {
  const trimmed = value?.trim() ?? '';
  return normalized(trimmed) === normalized(unknownLabel) ? '' : trimmed;
}

export function TvRemoteControlScreen({ sessionId, username }: TvRemoteControlScreenProps) {
  const library = useLibraryData();
  const [state, setState] = useState<RemoteState>('loading');
  const [transport, setTransport] = useState<TvRemoteTransportStatus>('connecting');
  const [snapshot, setSnapshot] = useState<TvRemotePlaybackSnapshot | null>(null);
  const [pendingControl, setPendingControl] = useState<string | null>(null);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<LibraryScope>('all');
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

  const visibleTracks = useMemo(() => {
    const needle = normalized(query);
    const playlistTrackIds = new Set(
      library.playlists
        .filter(playlist => !needle || normalized(playlist.name).includes(needle))
        .flatMap(playlist => playlist.trackIds)
    );

    return library.tracks.filter(track => {
      if (!needle) return scope === 'playlists' ? playlistTrackIds.has(track.id) : true;
      const titleMatch = normalized(track.title).includes(needle);
      const artistMatch = normalized(`${track.artist} ${track.albumArtist}`).includes(needle);
      const albumMatch = normalized(track.album).includes(needle);
      const playlistMatch = playlistTrackIds.has(track.id);
      if (scope === 'tracks') return titleMatch;
      if (scope === 'artists') return artistMatch;
      if (scope === 'albums') return albumMatch;
      if (scope === 'playlists') return playlistMatch;
      return titleMatch || artistMatch || albumMatch || playlistMatch;
    }).slice(0, 40);
  }, [library.playlists, library.tracks, query, scope]);

  async function sendControl(key: string, command: TvRemoteCommand) {
    if (pendingControl) return;
    setPendingControl(key);
    setError(null);
    try {
      await sendTvRemoteCommand(sessionId, command);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível enviar o comando.';
      setError(message);
      if (message.includes('não encontrado')) setState('missing');
    } finally {
      setPendingControl(null);
    }
  }

  async function playTrack(trackId: string) {
    if (pendingTrackId) return;
    setPendingTrackId(trackId);
    setError(null);
    try {
      await sendTvRemoteCommand(sessionId, { type: 'play-track', trackId });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível tocar esta música.';
      setError(message);
      if (message.includes('não encontrado')) setState('missing');
    } finally {
      setPendingTrackId(null);
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
  const controlsDisabled = !hasTrack || pendingControl !== null;
  const transportLabel = transport === 'open' ? 'Conectado' : transport === 'error' ? 'Reconectando…' : 'Conectando…';
  const snapshotArtist = visibleMetadata(snapshot?.artist, 'Artista desconhecido');

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
          <p>{snapshotArtist || (hasTrack ? '' : 'Escolha uma música abaixo')}</p>
          <div className="tv-remote-progress" aria-label={snapshot ? `${formatTime(snapshot.currentTime)} de ${formatTime(snapshot.duration)}` : 'Sem progresso'}>
            <span><i style={{ width: `${progress}%` }} /></span>
            <div><small>{formatTime(snapshot?.currentTime ?? 0)}</small><small>{formatTime(snapshot?.duration ?? 0)}</small></div>
          </div>
        </div>

        <div className="tv-remote-controls" aria-label="Controles da TV" aria-busy={pendingControl !== null}>
          <button type="button" aria-label="Voltar 10 segundos" disabled={controlsDisabled} onClick={() => void sendControl('back', { type: 'seek', deltaSeconds: -10 })}><RotateCcw /><span>10s</span></button>
          <button type="button" aria-label="Faixa anterior" disabled={controlsDisabled} onClick={() => void sendControl('previous', { type: 'previous' })}><SkipBack /></button>
          <button className="tv-remote-controls__primary" type="button" aria-label={snapshot?.playing ? 'Pausar' : 'Tocar'} disabled={controlsDisabled} onClick={() => void sendControl('toggle', { type: 'toggle-play' })}>{snapshot?.playing ? <Pause /> : <Play />}</button>
          <button type="button" aria-label="Próxima faixa" disabled={controlsDisabled} onClick={() => void sendControl('next', { type: 'next' })}><SkipForward /></button>
          <button type="button" aria-label="Avançar 10 segundos" disabled={controlsDisabled} onClick={() => void sendControl('forward', { type: 'seek', deltaSeconds: 10 })}><RotateCw /><span>10s</span></button>
        </div>

        <button className="tv-remote-library-toggle" type="button" aria-expanded={chooserOpen} onClick={() => setChooserOpen(open => !open)}>
          <ListMusic aria-hidden="true" />
          {chooserOpen ? 'Fechar músicas' : 'Escolher música'}
        </button>

        {chooserOpen && (
          <section className="tv-remote-library" aria-label="Escolher música">
            <label className="tv-remote-library__search">
              <Search aria-hidden="true" />
              <span className="sr-only">Buscar na biblioteca</span>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar música, artista, álbum…" autoComplete="off" />
            </label>

            <div className="tv-remote-library__tabs" role="tablist" aria-label="Filtrar biblioteca">
              {scopes.map(item => (
                <button key={item.id} type="button" role="tab" aria-selected={scope === item.id} onClick={() => setScope(item.id)}>{item.label}</button>
              ))}
            </div>

            {library.loading ? (
              <p className="tv-remote-library__status">Carregando biblioteca…</p>
            ) : library.error ? (
              <div className="tv-remote-library__status"><span>{library.error}</span><button type="button" onClick={() => void library.retry()}>Tentar novamente</button></div>
            ) : visibleTracks.length === 0 ? (
              <p className="tv-remote-library__status">Nenhuma música encontrada.</p>
            ) : (
              <div className="tv-remote-library__results" aria-live="polite">
                {visibleTracks.map(track => {
                  const currentTrack = snapshot?.trackId === track.id;
                  const loadingTrack = pendingTrackId === track.id;
                  const artist = visibleMetadata(track.albumArtist || track.artist, 'Artista desconhecido');
                  const album = visibleMetadata(track.album, 'Álbum desconhecido');
                  return (
                    <button
                      key={track.id}
                      className="tv-remote-library__track"
                      type="button"
                      aria-current={currentTrack ? 'true' : undefined}
                      aria-busy={loadingTrack}
                      disabled={pendingTrackId !== null}
                      onClick={() => void playTrack(track.id)}
                    >
                      <span><strong>{track.title}</strong><small>{[artist, album].filter(Boolean).join(' · ')}</small></span>
                      {loadingTrack ? <LoaderCircle className="tv-remote-library__spinner" aria-hidden="true" /> : currentTrack ? <em>Tocando agora</em> : <Play aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {error && <p className="tv-remote-card__error" role="alert">{error}</p>}
        <p className="tv-remote-card__hint">A reprodução acontece somente na TV. Este celular envia comandos para ela.</p>
      </section>
    </main>
  );
}
