import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import {
  ChevronLeft,
  ChevronRight,
  Folder,
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
  buildLibraryNavigationIndex,
  getIndexedFolderView
} from '../library-navigation-index';
import { matchesTrack, normalizeSearch } from '../library-utils';
import {
  backTvRemoteLibraryLocation,
  shouldShowTvRemoteLibrarySearch,
  type TvRemoteLibraryLocation
} from '../tv-remote-library-navigation';
import {
  getTvRemoteSession,
  openTvRemoteEvents,
  sendTvRemoteCommand,
  type TvRemoteTransportStatus
} from '../tv-remote-client';
import { isTvRemotePlaybackFresh } from '../tv-remote-presence';
import { useLibraryData } from '../useLibraryData';
import { Artwork } from './Artwork';

type RemoteState = 'loading' | 'ready' | 'missing' | 'closed' | 'error';
type RemoteView = 'control' | 'library';

const TRACK_PAGE_SIZE = 40;

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
  const [lastSnapshotReceivedAt, setLastSnapshotReceivedAt] = useState<number | null>(null);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [pendingControl, setPendingControl] = useState<string | null>(null);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [view, setView] = useState<RemoteView>('control');
  const [libraryLocation, setLibraryLocation] = useState<TvRemoteLibraryLocation>({ kind: 'root' });
  const [query, setQuery] = useState('');
  const [visibleTrackLimit, setVisibleTrackLimit] = useState(TRACK_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const libraryEntryRef = useRef<HTMLButtonElement>(null);
  const libraryBackRef = useRef<HTMLButtonElement>(null);
  const expandedTrackFocusRef = useRef<HTMLButtonElement>(null);
  const expandedTrackFocusIndexRef = useRef<number | null>(null);
  const focusViewRef = useRef<RemoteView | null>(null);
  const focusLibraryLocationRef = useRef(false);
  const pendingTrackRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let stopEvents: (() => void) | null = null;
    setState('loading');
    setError(null);
    setSnapshot(null);
    setLastSnapshotReceivedAt(null);

    void getTvRemoteSession(sessionId).then(session => {
      if (disposed) return;
      const receivedAt = Date.now();
      setSnapshot(session.snapshot);
      setLastSnapshotReceivedAt(session.snapshot ? receivedAt : null);
      setPresenceNow(receivedAt);
      setState('ready');
      stopEvents = openTvRemoteEvents(sessionId, {
        onSnapshot: next => {
          const nextReceivedAt = Date.now();
          setSnapshot(next);
          setLastSnapshotReceivedAt(nextReceivedAt);
          setPresenceNow(nextReceivedAt);
        },
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
    if (state !== 'ready') return;
    const timer = window.setInterval(() => setPresenceNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (focusViewRef.current !== view) return;
    const target = view === 'library' ? libraryBackRef.current : libraryEntryRef.current;
    target?.focus({ preventScroll: true });
    focusViewRef.current = null;
  }, [view]);

  useEffect(() => {
    if (view !== 'library' || !focusLibraryLocationRef.current) return;
    libraryBackRef.current?.focus({ preventScroll: true });
    focusLibraryLocationRef.current = false;
  }, [libraryLocation, view]);

  useEffect(() => {
    if (expandedTrackFocusIndexRef.current === null) return;
    expandedTrackFocusRef.current?.focus({ preventScroll: true });
    expandedTrackFocusIndexRef.current = null;
  }, [visibleTrackLimit]);

  const libraryIndex = useMemo(
    () => buildLibraryNavigationIndex(library.tracks),
    [library.tracks]
  );

  const folderView = useMemo(
    () => libraryLocation.kind === 'folders'
      ? getIndexedFolderView(libraryIndex, libraryLocation.folderPath)
      : null,
    [libraryIndex, libraryLocation]
  );

  const selectedPlaylist = useMemo(
    () => libraryLocation.kind === 'playlist'
      ? library.playlists.find(playlist => playlist.id === libraryLocation.playlistId) ?? null
      : null,
    [library.playlists, libraryLocation]
  );

  const normalizedQuery = normalizeSearch(query);
  const visibleFolders = useMemo(
    () => folderView && !normalizedQuery ? folderView.folders : [],
    [folderView, normalizedQuery]
  );

  const matchingTracks = useMemo(() => {
    let contextTracks = folderView
      ? normalizedQuery ? folderView.allTracks : folderView.directTracks
      : selectedPlaylist
        ? selectedPlaylist.trackIds
          .map(id => libraryIndex.trackMap.get(id))
          .filter((track): track is Track => Boolean(track))
        : [];

    if (normalizedQuery) {
      contextTracks = contextTracks.filter(track => matchesTrack(
        track,
        normalizedQuery,
        libraryIndex.searchTextByTrackId.get(track.id)
      ));
    }

    return contextTracks;
  }, [folderView, libraryIndex, normalizedQuery, selectedPlaylist]);

  const visibleTracks = useMemo(
    () => matchingTracks.slice(0, visibleTrackLimit),
    [matchingTracks, visibleTrackLimit]
  );
  const hasMoreTracks = visibleTracks.length < matchingTracks.length;

  const currentTrack = useMemo(
    () => library.tracks.find(track => track.id === snapshot?.trackId),
    [library.tracks, snapshot?.trackId]
  );

  const libraryTitle = libraryLocation.kind === 'root'
    ? 'Biblioteca'
    : libraryLocation.kind === 'folders'
      ? folderView?.name ?? 'Pastas'
      : libraryLocation.kind === 'playlists'
        ? 'Playlists'
        : selectedPlaylist?.name ?? 'Playlist';
  const librarySubtitle = libraryLocation.kind === 'root'
    ? 'Escolha onde procurar uma música.'
    : libraryLocation.kind === 'folders'
      ? libraryLocation.folderPath ? 'Escolha uma subpasta ou música.' : 'Escolha uma pasta.'
      : libraryLocation.kind === 'playlists'
        ? 'Escolha uma playlist.'
        : 'Escolha uma música para tocar na TV.';
  const showLibrarySearch = shouldShowTvRemoteLibrarySearch(libraryLocation);

  function resetVisibleTracks() {
    expandedTrackFocusIndexRef.current = null;
    setVisibleTrackLimit(TRACK_PAGE_SIZE);
  }

  function showMoreTracks() {
    const firstHiddenTrackIndex = visibleTracks.length;
    expandedTrackFocusIndexRef.current = firstHiddenTrackIndex + TRACK_PAGE_SIZE >= matchingTracks.length
      ? firstHiddenTrackIndex
      : null;
    setVisibleTrackLimit(limit => limit + TRACK_PAGE_SIZE);
  }

  function switchView(next: RemoteView) {
    focusViewRef.current = next;
    setView(next);
  }

  function openLibrary() {
    setLibraryLocation({ kind: 'root' });
    setQuery('');
    resetVisibleTracks();
    setError(null);
    switchView('library');
  }

  function navigateLibrary(next: TvRemoteLibraryLocation) {
    focusLibraryLocationRef.current = true;
    setLibraryLocation(next);
    setQuery('');
    resetVisibleTracks();
    setError(null);
  }

  function backLibrary() {
    const previous = backTvRemoteLibraryLocation(libraryLocation);
    setQuery('');
    resetVisibleTracks();
    setError(null);
    if (!previous) {
      switchView('control');
      return;
    }
    focusLibraryLocationRef.current = true;
    setLibraryLocation(previous);
  }

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
    if (pendingTrackRef.current) return;
    pendingTrackRef.current = trackId;
    setPendingTrackId(trackId);
    setError(null);
    try {
      await sendTvRemoteCommand(sessionId, { type: 'play-track', trackId });
      switchView('control');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível tocar esta música.';
      setError(message);
    } finally {
      pendingTrackRef.current = null;
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
  const connected = isTvRemotePlaybackFresh(transport, lastSnapshotReceivedAt, presenceNow);
  const trackControlsDisabled = !connected || !hasTrack || pendingControl !== null;
  const modeControlsDisabled = !connected || !hasTrack || pendingControl !== null;
  const transportLabel = connected
    ? 'TV conectada'
    : transport === 'error'
      ? 'Reconectando…'
      : transport === 'open' && lastSnapshotReceivedAt !== null
        ? 'TV desconectada'
        : 'Conectando…';
  const snapshotArtist = visibleMetadata(snapshot?.artist, 'Artista desconhecido');
  const repeatMode = snapshot?.repeatMode ?? 'off';

  const renderTrack = (track: Track, index: number) => {
    const current = snapshot?.trackId === track.id;
    const loadingTrack = pendingTrackId === track.id;
    const artist = visibleMetadata(track.albumArtist || track.artist, 'Artista desconhecido');
    const album = visibleMetadata(track.album, 'Álbum desconhecido');
    return (
      <button
        key={track.id}
        ref={index === expandedTrackFocusIndexRef.current ? expandedTrackFocusRef : undefined}
        className="tv-remote-library__track"
        type="button"
        aria-current={current ? 'true' : undefined}
        aria-busy={loadingTrack}
        disabled={loadingTrack}
        onClick={() => void playTrack(track.id)}
      >
        <span><strong>{track.title}</strong><small>{[artist, album].filter(Boolean).join(' · ')}</small></span>
        {loadingTrack ? <LoaderCircle className="tv-remote-library__spinner" aria-hidden="true" /> : current ? <em>Tocando</em> : <Play aria-hidden="true" />}
      </button>
    );
  };

  const renderMoreTracks = hasMoreTracks ? (
    <div className="tv-remote-library__status">
      <button type="button" onClick={showMoreTracks}>
        Mostrar mais músicas
      </button>
    </div>
  ) : null;

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

            <button ref={libraryEntryRef} className="tv-remote-library-entry" type="button" onClick={openLibrary}>
              <span className="tv-remote-library-entry__icon"><ListMusic aria-hidden="true" /></span>
              <span className="tv-remote-library-entry__copy"><strong>Biblioteca</strong><small>Pastas e playlists</small></span>
              <ChevronRight aria-hidden="true" />
            </button>

            {error && <p className="tv-remote-card__error" role="alert">{error}</p>}
          </>
        ) : (
          <section className="tv-remote-library" aria-label="Biblioteca">
            <div className="tv-remote-library__heading">
              <button ref={libraryBackRef} type="button" aria-label="Voltar" onClick={backLibrary}><ChevronLeft aria-hidden="true" /></button>
              <div><h1>{libraryTitle}</h1><p>{librarySubtitle}</p></div>
            </div>

            {showLibrarySearch && (
              <label className="tv-remote-library__search">
                <Search aria-hidden="true" />
                <span className="sr-only">Buscar músicas neste contexto</span>
                <input
                  value={query}
                  onChange={event => {
                    setQuery(event.target.value);
                    resetVisibleTracks();
                  }}
                  placeholder="Buscar música, artista ou álbum…"
                  autoComplete="off"
                />
              </label>
            )}

            {error && <p className="tv-remote-card__error" role="alert">{error}</p>}

            {library.loading ? (
              <p className="tv-remote-library__status">Carregando biblioteca…</p>
            ) : library.error ? (
              <div className="tv-remote-library__status"><span>{library.error}</span><button type="button" onClick={() => void library.retry()}>Tentar novamente</button></div>
            ) : libraryLocation.kind === 'root' ? (
              <div className="tv-remote-library__results">
                <button className="tv-remote-library__item" type="button" onClick={() => navigateLibrary({ kind: 'folders', folderPath: '' })}>
                  <span className="tv-remote-library__item-icon"><Folder aria-hidden="true" /></span>
                  <span className="tv-remote-library__item-copy"><strong>Pastas</strong><small>Navegar pela organização da biblioteca</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
                <button className="tv-remote-library__item" type="button" onClick={() => navigateLibrary({ kind: 'playlists' })}>
                  <span className="tv-remote-library__item-icon"><ListMusic aria-hidden="true" /></span>
                  <span className="tv-remote-library__item-copy"><strong>Playlists</strong><small>{library.playlists.length} {library.playlists.length === 1 ? 'playlist' : 'playlists'}</small></span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            ) : libraryLocation.kind === 'playlists' ? (
              library.playlists.length === 0 ? (
                <p className="tv-remote-library__status">Nenhuma playlist encontrada.</p>
              ) : (
                <div className="tv-remote-library__results">
                  {library.playlists.map(playlist => (
                    <button key={playlist.id} className="tv-remote-library__item" type="button" onClick={() => navigateLibrary({ kind: 'playlist', playlistId: playlist.id })}>
                      <span className="tv-remote-library__item-icon"><ListMusic aria-hidden="true" /></span>
                      <span className="tv-remote-library__item-copy"><strong>{playlist.name}</strong><small>{playlist.trackIds.length} {playlist.trackIds.length === 1 ? 'música' : 'músicas'}</small></span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )
            ) : libraryLocation.kind === 'folders' ? (
              visibleFolders.length === 0 && visibleTracks.length === 0 ? (
                <p className="tv-remote-library__status">{normalizedQuery ? 'Nenhuma música encontrada.' : 'Esta pasta está vazia.'}</p>
              ) : (
                <div className="tv-remote-library__results" aria-live="polite">
                  {visibleFolders.map(folder => (
                    <button key={folder.path} className="tv-remote-library__item" type="button" onClick={() => navigateLibrary({ kind: 'folders', folderPath: folder.path })}>
                      <span className="tv-remote-library__item-icon"><Folder aria-hidden="true" /></span>
                      <span className="tv-remote-library__item-copy"><strong>{folder.name}</strong><small>{folder.tracks.length} {folder.tracks.length === 1 ? 'música' : 'músicas'}</small></span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                  {visibleTracks.map(renderTrack)}
                  {renderMoreTracks}
                </div>
              )
            ) : !selectedPlaylist ? (
              <p className="tv-remote-library__status">Playlist não encontrada.</p>
            ) : visibleTracks.length === 0 ? (
              <p className="tv-remote-library__status">{normalizedQuery ? 'Nenhuma música encontrada.' : 'Esta playlist está vazia.'}</p>
            ) : (
              <div className="tv-remote-library__results" aria-live="polite">
                {visibleTracks.map(renderTrack)}
                {renderMoreTracks}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
