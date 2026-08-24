import { useEffect, useRef, useState } from 'react';
import type { LibraryResponse, Track } from '@home-music/shared';
import { LibraryScreen } from './components/LibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { buildQueueContext } from './library-utils';

const apiBase = import.meta.env.VITE_API_URL || '';
type Screen = 'player' | 'library';

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [screen, setScreen] = useState<Screen>('player');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const current = queue[currentIndex];
  const hasNext = currentIndex < queue.length - 1;

  useEffect(() => {
    fetch(`${apiBase}/api/library`)
      .then(async response => {
        if (!response.ok) throw new Error('Falha ao carregar biblioteca');
        return response.json() as Promise<LibraryResponse>;
      })
      .then(data => {
        setTracks(data.tracks);
        setQueue(data.tracks);
        setCurrentIndex(0);
        setError(null);
      })
      .catch(() => setError('Não consegui acessar o servidor de músicas.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;

    setCurrentTime(0);
    setDuration(current.duration ?? 0);
    audio.src = `${apiBase}/api/tracks/${current.id}/stream`;
    audio.load();

    if (playing) {
      audio.play().catch(() => setPlaying(false));
    }
  }, [current?.id]);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !current) return;

    try {
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
      }
    } catch {
      setPlaying(false);
    }
  }

  function next() {
    if (!queue.length) return;

    if (!hasNext) {
      setPlaying(false);
      return;
    }

    setCurrentIndex(index => index + 1);
  }

  function previous() {
    const audio = audioRef.current;
    if (!audio || !queue.length) return;

    if (audio.currentTime > 3 || currentIndex === 0) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    setCurrentIndex(index => Math.max(0, index - 1));
  }

  function playTrack(track: Track, contextTracks: Track[]) {
    const context = buildQueueContext(track, contextTracks);
    const sameTrack = current?.id === track.id;

    setQueue(context.queue);
    setCurrentIndex(context.index);
    setPlaying(true);

    if (sameTrack && audioRef.current?.paused) {
      audioRef.current.play().catch(() => setPlaying(false));
    }
  }

  function seek(value: number) {
    if (audioRef.current) audioRef.current.currentTime = value;
    setCurrentTime(value);
  }

  return (
    <main className="app-shell">
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={event => {
          if (screen === 'player') setCurrentTime(event.currentTarget.currentTime);
        }}
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
          <PlayerScreen
            current={current}
            tracksCount={tracks.length}
            queue={queue}
            currentIndex={currentIndex}
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            onOpenLibrary={() => setScreen('library')}
            onTogglePlay={togglePlay}
            onPrevious={previous}
            onNext={next}
            onSeek={seek}
            onPlayTrack={playTrack}
          />
        ) : (
          <LibraryScreen
            tracks={tracks}
            current={current}
            playing={playing}
            hasNext={hasNext}
            onOpenPlayer={() => setScreen('player')}
            onTogglePlay={togglePlay}
            onNext={next}
            onPlayTrack={playTrack}
          />
        )}
      </section>
    </main>
  );
}
