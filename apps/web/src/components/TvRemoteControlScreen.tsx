import { useEffect, useMemo, useState } from 'react';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Tv
} from 'lucide-react';
import {
  getTvRemoteSession,
  openTvRemoteEvents,
  sendTvRemoteCommand,
  type TvRemoteTransportStatus
} from '../tv-remote-client';
import { useLibraryData } from '../useLibraryData';
import { Artwork } from './Artwork';

type RemoteState = 'loading' | 'ready' | 'missing' | 'closed' | 'error';
type RemoteView = 'control' | 'library';

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
  const [view, setView] = useState<RemoteView>('control');
  const [query, setQuery] = useState('');
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
    return library.tracks.filter(track => {
      if (!needle) return true;
      return normalized(track.title).includes(needle)
        || normalized(`${track.artist} ${track.albumArtist}`).includes(needle)
        || normalized(track.album).includes(needle);
    }).slice(0, 40);
  }, [library.tracks, query]);

  const currentTrack = useMemo(
    () => library.tracks.find(track => track.id === snapshot?.trackId),
    [library.tracks, snapshot?.trackId]
  );

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
      setView('control');
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
  const trackControlsDisabled = !hasTrack || pendingControl !== null;
  const modeControlsDisabled = !hasTrack || pendingControl !== null;
  const connected = transport === 'open';
  const transportLabel = connected ? 'TV conectada' : transport === 'error' ? 'Reconectando…' : 'Conectando…';
  const snapshotArtist = visibleMetadata(snapshot?.artist, 'Artista desconhecido');
  const repeatMode = snapshot?.repeatMode ?? 'off';

  return (
    <main className="tv-remote-screen">
      <section className={`tv-remote-card tv-remote-card--${view}`}>
        <header className="tv-remote-card__header">
          <div className="tv-remote-connection">
            <span className="tv-remote-connection__icon"><Tv aria-hidden="true" /></span>
            <strong>{transportLabel}</strong>
            <i className={connected ? 'is-connected' : ''} aria-hidden="true" />
          </div>
        </header>

        {view === 'control' ? (
          <>
            <div className="tv-remote-now-playing" aria-live="polite">
              <div className="tv-remote-artwork"><Artwork track={currentTrack} large /></div>
              <div className="tv-remote-now-playing__meta">
                <h1>{snapshot?.title || 'Nenhuma música tocando'}</h1>
                <p>{snapshotArtist || (hasTrack ? '' : 'Escolha uma música na biblioteca')}</p>
              </div>
              <div className="tv-remote-progress" aria-label={snapshot ? `${formatTime(snapshot.currentTime)} de ${formatTime(snapshot.duration)}` : 'Sem progresso'}>
                <span><i style={{ width: `${progress}%` }} /></span>
                <div><small>{formatTime(snapshot?.currentTime ?? 0)}</small><small>{formatTime(snapshot?.duration ?? 0)}</small></div>
              </div>
            </div>

            <div className="tv-remote-controls" aria-label="Controles da TV" aria-busy={pendingControl !== null}>
              <button
                className={snapshot?.shuffle ? 'is-active' : ''}
                type="button"
                aria-label="Aleatório"
                aria-pressed={Boolean(snapshot?.shuffle)}
                disabled={modeControlsDisabled}
                onClick={() => void sendControl('shuffle', { type: 'toggle-shuffle' })}
              ><Shuffle aria-hidden="true" /></button>
              <button type="button" aria-label="Faixa anterior" disabled={trackControlsDisabled} onClick={() => void sendControl('previous', { type: 'previous' })}><SkipBack aria-hidden="true" /></button>
              <button className="tv-remote-controls__primary" type="button" aria-label={snapshot?.playing ? 'Pausar' : 'Tocar'} disabled={trackControlsDisabled} onClick={() => void sendControl('toggle', { type: 'toggle-play' })}>{snapshot?.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
              <button type="button" aria-label="Próxima faixa" disabled={trackControlsDisabled} onClick={() => void sendControl('next', { type: 'next' })}><SkipForward aria-hidden="true" /></button>
              <button
                className={repeatMode !== 'off' ? 'is-active' : ''}
                type="button"
                aria-label={repeatMode === 'one' ? 'Repetir uma' : repeatMode === 'all' ? 'Repetir fila' : 'Repetição desligada'}
                aria-pressed={repeatMode !== 'off'}
                disabled={modeControlsDisabled}
                onClick={() => void sendControl('repeat', { type: 'cycle-repeat' })}
              >{repeatMode === 'one' ? <Repeat1 aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}</button>
            </div>

            <button className="tv-remote-library-entry" type="button" onClick={() => setView('library')}>
              <span className="tv-remote-library-entry__icon"><ListMusic aria-hidden="true" /></span>
              <span className="tv-remote-library-entry__copy"><strong>Biblioteca</strong><small>Buscar e escolher músicas</small></span>
              <ChevronRight aria-hidden="true" />
            </button>
          </>
        ) : (
          <section className="tv-remote-library" aria-label="Biblioteca">
            <div className="tv-remote-library__heading">
              <button type="button" aria-label="Voltar ao controle" onClick={() => setView('control')}><ChevronLeft aria-hidden="true" /></button>
              <div><h1>Biblioteca</h1><p>Escolha uma música para tocar na TV.</p></div>
            </div>

            <label className="tv-remote-library__search">
              <Search aria-hidden="true" />
              <span className="sr-only">Buscar na biblioteca</span>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar música, artista ou álbum…" autoComplete="off" />
            </label>

            {library.loading ? (
              <p className="tv-remote-library__status">Carregando biblioteca…</p>
            ) : library.error ? (
              <div className="tv-remote-library__status"><span>{library.error}</span><button type="button" onClick={() => void library.retry()}>Tentar novamente</button></div>
            ) : visibleTracks.length === 0 ? (
              <p className="tv-remote-library__status">Nenhuma música encontrada.</p>
            ) : (
              <div className="tv-remote-library__results" aria-live="polite">
                {visibleTracks.map(track => {
                  const current = snapshot?.trackId === track.id;
                  const loadingTrack = pendingTrackId === track.id;
                  const artist = visibleMetadata(track.albumArtist || track.artist, 'Artista desconhecido');
                  const album = visibleMetadata(track.album, 'Álbum desconhecido');
                  return (
                    <button
                      key={track.id}
                      className="tv-remote-library__track"
                      type="button"
                      aria-current={current ? 'true' : undefined}
                      aria-busy={loadingTrack}
                      disabled={pendingTrackId !== null}
                      onClick={() => void playTrack(track.id)}
                    >
                      <span><strong>{track.title}</strong><small>{[artist, album].filter(Boolean).join(' · ')}</small></span>
                      {loadingTrack ? <LoaderCircle className="tv-remote-library__spinner" aria-hidden="true" /> : current ? <em>Tocando</em> : <Play aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {error && <p className="tv-remote-card__error" role="alert">{error}</p>}
      </section>
    </main>
  );
}
