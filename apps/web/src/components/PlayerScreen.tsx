import type { CSSProperties } from 'react';
import {
  ChevronDown,
  Heart,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward
} from 'lucide-react';
import type { Track } from '@home-music/shared';
import { Artwork } from './Artwork';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

type PlayerScreenProps = {
  current: Track;
  tracksCount: number;
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  onOpenLibrary: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
};

export function PlayerScreen({
  current,
  tracksCount,
  queue,
  currentIndex,
  playing,
  currentTime,
  duration,
  onOpenLibrary,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onPlayTrack
}: PlayerScreenProps) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const hasNext = currentIndex < queue.length - 1;

  return (
    <>
      <header className="topbar">
        <button className="icon-button" aria-label="Abrir biblioteca" onClick={onOpenLibrary}><ChevronDown /></button>
        <span className="topbar__title">Tocando agora</span>
        <button className="icon-button" aria-label="Mais opções" disabled title="Em breve"><MoreVertical /></button>
      </header>

      <div className="hero-art"><Artwork track={current} large /></div>

      <div className="track-heading">
        <div>
          <h1>{current.title}</h1>
          <p>{current.artist}</p>
        </div>
        <button className="icon-button icon-button--large" aria-label="Favoritar" disabled title="Favoritos chegam na próxima etapa"><Heart /></button>
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
          onChange={event => onSeek(Number(event.target.value))}
        />
        <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
      </div>

      <div className="controls">
        <button className="icon-button" aria-label="Aleatório" disabled title="Shuffle chega na próxima etapa"><Shuffle /></button>
        <button className="icon-button icon-button--control" aria-label="Anterior" onClick={onPrevious}><SkipBack /></button>
        <button className="play-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="icon-button icon-button--control" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward /></button>
        <button className="icon-button" aria-label="Repetir" disabled title="Repeat chega na próxima etapa"><Repeat2 /></button>
      </div>

      <button className="library-toggle" onClick={onOpenLibrary}>
        <ListMusic />
        <span>Abrir biblioteca</span>
        <span className="library-toggle__count">{tracksCount}</span>
      </button>

      <section className="queue-panel">
        <div className="queue-label">Próximas na fila</div>
        <div className="queue-list">
          {queue.slice(currentIndex + 1, currentIndex + 7).map(track => (
            <button className="queue-item queue-item--button" key={track.id} onClick={() => onPlayTrack(track, queue)}>
              <Artwork track={track} />
              <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
              <Play className="queue-item__action" />
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
