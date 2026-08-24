import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Folder,
  Heart,
  ListMusic,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Repeat2,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Users
} from 'lucide-react';
import type { LibraryResponse, Track } from '@home-music/shared';

const apiBase = import.meta.env.VITE_API_URL || '';
const PAGE_SIZE = 100;

type Screen = 'player' | 'library';
type LibraryTab = 'folders' | 'artists' | 'albums' | 'tracks';
type GroupTab = Exclude<LibraryTab, 'tracks'>;

type LibraryGroup = {
  name: string;
  tracks: Track[];
  artwork?: Track;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function coverUrl(track: Track) {
  return track.hasCover ? `${apiBase}/api/tracks/${track.id}/cover` : null;
}

function Artwork({ track, large = false }: { track?: Track; large?: boolean }) {
  const url = track ? coverUrl(track) : null;

  return (
    <div className={large ? 'artwork artwork--large' : 'artwork'}>
      {url ? <img src={url} alt="" loading={large ? 'eager' : 'lazy'} /> : <Music2 aria-hidden="true" />}
    </div>
  );
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR');
}

function matchesTrack(track: Track, query: string) {
  if (!query) return true;
  return normalize(`${track.title} ${track.artist} ${track.album} ${track.folder}`).includes(query);
}

function groupTracks(tracks: Track[], getName: (track: Track) => string) {
  const groups = new Map<string, Track[]>();

  for (const track of tracks) {
    const name = getName(track) || 'Desconhecido';
    const current = groups.get(name) ?? [];
    current.push(track);
    groups.set(name, current);
  }

  return [...groups.entries()]
    .map(([name, items]): LibraryGroup => ({
      name,
      tracks: items,
      artwork: items.find(item => item.hasCover) ?? items[0]
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function groupLabel(tab: GroupTab) {
  if (tab === 'folders') return 'Pasta';
  if (tab === 'artists') return 'Artista';
  return 'Álbum';
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [screen, setScreen] = useState<Screen>('player');
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('folders');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const current = queue[currentIndex];
  const normalizedQuery = normalize(query);

  useEffect(() => {
    fetch(`${apiBase}/api/library`)
      .then(async response => {
        if (!response.ok) throw new Error('Falha ao carregar biblioteca');
        return response.json() as Promise<LibraryResponse>;
      })
      .then(data => {
        setTracks(data.tracks);
        setQueue(data.tracks);
        setError(null);
      })
      .catch(() => setError('Não consegui acessar o servidor de músicas.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;

    audio.src = `${apiBase}/api/tracks/${current.id}/stream`;
    audio.load();

    if (playing) {
      audio.play().catch(() => setPlaying(false));
    }
  }, [current?.id]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [libraryTab, selectedGroup, normalizedQuery]);

  const groups = useMemo(() => {
    if (libraryTab === 'folders') return groupTracks(tracks, track => track.folder);
    if (libraryTab === 'artists') return groupTracks(tracks, track => track.artist);
    if (libraryTab === 'albums') return groupTracks(tracks, track => track.album);
    return [];
  }, [libraryTab, tracks]);

  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups.filter(group =>
      normalize(group.name).includes(normalizedQuery) ||
      group.tracks.some(track => matchesTrack(track, normalizedQuery))
    );
  }, [groups, normalizedQuery]);

  const libraryTracks = useMemo(() => {
    let source = tracks;

    if (libraryTab !== 'tracks' && selectedGroup) {
      const group = groups.find(item => item.name === selectedGroup);
      source = group?.tracks ?? [];
    }

    return source.filter(track => matchesTrack(track, normalizedQuery));
  }, [groups, libraryTab, normalizedQuery, selectedGroup, tracks]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !current) return;

    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function next() {
    if (!queue.length) return;
    setCurrentIndex(index => (index + 1) % queue.length);
  }

  function previous() {
    if (!queue.length) return;
    setCurrentIndex(index => (index - 1 + queue.length) % queue.length);
  }

  function playTrack(track: Track) {
    const index = queue.findIndex(item => item.id === track.id);

    if (index >= 0) {
      if (index === currentIndex && audioRef.current) {
        audioRef.current.play().catch(() => setPlaying(false));
      }
      setCurrentIndex(index);
    } else {
      setQueue(items => [track, ...items]);
      setCurrentIndex(0);
    }

    setPlaying(true);
  }

  function selectTab(tab: LibraryTab) {
    setLibraryTab(tab);
    setSelectedGroup(null);
    setQuery('');
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const selectedGroupTracks = libraryTracks.slice(0, visibleCount);
  const shouldShowTracks = libraryTab === 'tracks' || Boolean(selectedGroup);

  return (
    <main className="app-shell">
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
        onEnded={next}
      />

      <section className={`phone-surface ${screen === 'library' ? 'phone-surface--library' : ''}`}>
        {loading ? (
          <div className="center-state">Carregando sua biblioteca…</div>
        ) : error ? (
          <div className="center-state">
            <strong>Servidor indisponível</strong>
            <span>{error}</span>
          </div>
        ) : !current ? (
          <div className="center-state">
            <strong>Nenhuma música encontrada</strong>
            <span>Configure MUSIC_DIR no arquivo .env e faça um novo scan.</span>
          </div>
        ) : screen === 'player' ? (
          <>
            <header className="topbar">
              <button className="icon-button" aria-label="Abrir biblioteca" onClick={() => setScreen('library')}><ChevronDown /></button>
              <span className="topbar__title">Tocando agora</span>
              <button className="icon-button" aria-label="Mais opções"><MoreVertical /></button>
            </header>

            <div className="hero-art"><Artwork track={current} large /></div>

            <div className="track-heading">
              <div>
                <h1>{current.title}</h1>
                <p>{current.artist}</p>
              </div>
              <button className="icon-button icon-button--large" aria-label="Favoritar"><Heart /></button>
            </div>

            <div className="progress-wrap">
              <input
                aria-label="Progresso da música"
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(currentTime, duration || 0)}
                style={{ '--progress': `${progress}%` } as CSSProperties}
                onChange={event => {
                  const value = Number(event.target.value);
                  if (audioRef.current) audioRef.current.currentTime = value;
                  setCurrentTime(value);
                }}
              />
              <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
            </div>

            <div className="controls">
              <button className="icon-button" aria-label="Aleatório"><Shuffle /></button>
              <button className="icon-button icon-button--control" aria-label="Anterior" onClick={previous}><SkipBack /></button>
              <button className="play-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={togglePlay}>
                {playing ? <Pause /> : <Play />}
              </button>
              <button className="icon-button icon-button--control" aria-label="Próxima" onClick={next}><SkipForward /></button>
              <button className="icon-button" aria-label="Repetir"><Repeat2 /></button>
            </div>

            <button className="library-toggle" onClick={() => setScreen('library')}>
              <ListMusic />
              <span>Abrir biblioteca</span>
              <span className="library-toggle__count">{tracks.length}</span>
            </button>

            <section className="queue-panel">
              <div className="queue-label">Próximas na fila</div>
              <div className="queue-list">
                {queue.slice(currentIndex + 1, currentIndex + 7).map(track => (
                  <button className="queue-item queue-item--button" key={track.id} onClick={() => playTrack(track)}>
                    <Artwork track={track} />
                    <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
                    <Play className="queue-item__action" />
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <header className="library-header">
              {selectedGroup ? (
                <button className="icon-button" aria-label="Voltar" onClick={() => { setSelectedGroup(null); setQuery(''); }}><ChevronLeft /></button>
              ) : (
                <span className="library-header__spacer" />
              )}
              <div className="library-header__title">
                <strong>{selectedGroup ?? 'Biblioteca'}</strong>
                <small>{selectedGroup ? `${libraryTracks.length} músicas` : `${tracks.length} músicas`}</small>
              </div>
              <button className="icon-button" aria-label="Voltar ao player" onClick={() => setScreen('player')}><Music2 /></button>
            </header>

            <div className="search-box search-box--library">
              <Search />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Música, artista, álbum ou pasta" />
            </div>

            {!selectedGroup && (
              <nav className="library-tabs" aria-label="Navegação da biblioteca">
                <button className={libraryTab === 'folders' ? 'is-active' : ''} onClick={() => selectTab('folders')}><Folder />Pastas</button>
                <button className={libraryTab === 'artists' ? 'is-active' : ''} onClick={() => selectTab('artists')}><Users />Artistas</button>
                <button className={libraryTab === 'albums' ? 'is-active' : ''} onClick={() => selectTab('albums')}><Disc3 />Álbuns</button>
                <button className={libraryTab === 'tracks' ? 'is-active' : ''} onClick={() => selectTab('tracks')}><Music2 />Músicas</button>
              </nav>
            )}

            <section className="library-content">
              {shouldShowTracks ? (
                <>
                  <div className="section-heading">
                    <span>{selectedGroup ? groupLabel(libraryTab as GroupTab) : 'Todas as músicas'}</span>
                    <small>{libraryTracks.length}</small>
                  </div>
                  <div className="library-track-list">
                    {selectedGroupTracks.map(track => (
                      <button className={`library-track ${track.id === current.id ? 'is-current' : ''}`} key={track.id} onClick={() => playTrack(track)}>
                        <Artwork track={track} />
                        <span className="library-track__text">
                          <strong>{track.title}</strong>
                          <small>{track.artist} · {track.album}</small>
                        </span>
                        {track.id === current.id && playing ? <span className="playing-indicator">▶</span> : <Play className="library-track__action" />}
                      </button>
                    ))}
                  </div>
                  {visibleCount < libraryTracks.length && (
                    <button className="load-more" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
                      Mostrar mais {Math.min(PAGE_SIZE, libraryTracks.length - visibleCount)} músicas
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="section-heading">
                    <span>{libraryTab === 'folders' ? 'Pastas' : libraryTab === 'artists' ? 'Artistas' : 'Álbuns'}</span>
                    <small>{visibleGroups.length}</small>
                  </div>
                  <div className="group-list">
                    {visibleGroups.map(group => (
                      <button className="group-item" key={group.name} onClick={() => { setSelectedGroup(group.name); setQuery(''); }}>
                        <Artwork track={group.artwork} />
                        <span className="group-item__text"><strong>{group.name}</strong><small>{group.tracks.length} músicas</small></span>
                        <ChevronRight />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>

            <div className="mini-player">
              <button className="mini-player__main" onClick={() => setScreen('player')}>
                <Artwork track={current} />
                <span className="mini-player__text"><strong>{current.title}</strong><small>{current.artist}</small></span>
              </button>
              <button className="icon-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={togglePlay}>{playing ? <Pause /> : <Play />}</button>
              <button className="icon-button" aria-label="Próxima" onClick={next}><SkipForward /></button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
