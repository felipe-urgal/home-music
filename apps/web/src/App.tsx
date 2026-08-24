import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Heart,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  Repeat2,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  GripVertical,
  Music2
} from 'lucide-react';
import type { LibraryResponse, Track } from '@home-music/shared';

const apiBase = import.meta.env.VITE_API_URL || '';

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
      {url ? <img src={url} alt="" /> : <Music2 aria-hidden="true" />}
    </div>
  );
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);

  const current = queue[currentIndex];

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

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return tracks;
    return tracks.filter(track =>
      `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase('pt-BR').includes(normalized)
    );
  }, [query, tracks]);

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
    setShowLibrary(false);
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

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

      <section className="phone-surface">
        <header className="topbar">
          <button className="icon-button" aria-label="Minimizar"><ChevronDown /></button>
          <span className="topbar__title">Tocando agora</span>
          <button className="icon-button" aria-label="Mais opções"><MoreVertical /></button>
        </header>

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
        ) : (
          <>
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
                style={{ '--progress': `${progress}%` } as React.CSSProperties}
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

            <button className="library-toggle" onClick={() => setShowLibrary(value => !value)}>
              <ListMusic />
              <span>{showLibrary ? 'Voltar para a fila' : 'Buscar na biblioteca'}</span>
              <span className="library-toggle__count">{tracks.length}</span>
            </button>

            {showLibrary ? (
              <section className="queue-panel">
                <div className="search-box">
                  <Search />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Música, artista ou álbum" />
                </div>
                <div className="queue-label">Biblioteca</div>
                <div className="queue-list">
                  {filteredTracks.map(track => (
                    <button className="queue-item queue-item--button" key={track.id} onClick={() => playTrack(track)}>
                      <Artwork track={track} />
                      <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
                      <Play className="queue-item__action" />
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="queue-panel">
                <div className="queue-label">Próximas na fila</div>
                <div className="queue-list">
                  {queue.slice(currentIndex + 1, currentIndex + 7).map(track => (
                    <button className="queue-item queue-item--button" key={track.id} onClick={() => playTrack(track)}>
                      <Artwork track={track} />
                      <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
                      <GripVertical className="queue-item__action" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
