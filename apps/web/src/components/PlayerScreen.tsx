import { useState, type CSSProperties, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Heart,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2
} from 'lucide-react';
import type { Playlist, RepeatMode, Track } from '@home-music/shared';
import { Artwork } from './Artwork';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

type PlayerScreenProps = {
  current: Track;
  libraryReturnLabel: string;
  libraryReturnCount: number;
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  autoplayBlocked: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isFavorite: boolean;
  playlists: Playlist[];
  onOpenLibrary: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onToggleFavorite: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onReorderQueue: (from: number, to: number) => void;
  onAddToPlaylist: (playlist: Playlist) => void;
};

export function PlayerScreen({
  current,
  libraryReturnLabel,
  libraryReturnCount,
  queue,
  currentIndex,
  playing,
  autoplayBlocked,
  currentTime,
  duration,
  volume,
  shuffle,
  repeatMode,
  isFavorite,
  playlists,
  onOpenLibrary,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onShuffle,
  onRepeat,
  onToggleFavorite,
  onPlayTrack,
  onReorderQueue,
  onAddToPlaylist
}: PlayerScreenProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [usesSystemVolume] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const hasNext = currentIndex < queue.length - 1 || repeatMode === 'all';
  const visibleStart = Math.max(0, currentIndex);
  const visibleQueue = queue.slice(visibleStart, currentIndex + 10);

  function dropQueue(event: DragEvent, to: number) {
    event.preventDefault();
    if (dragFrom != null) onReorderQueue(dragFrom, to);
    setDragFrom(null);
  }

  return (
    <>
      <header className="topbar">
        <button className="icon-button" aria-label={libraryReturnLabel} onClick={onOpenLibrary}><ChevronDown /></button>
        <span className="topbar__title">Tocando agora</span>
        <button className="icon-button" aria-label="Mais opções" onClick={() => setShowOptions(value => !value)}><MoreVertical /></button>
      </header>

      {showOptions && (
        <div className="player-options">
          <strong>Adicionar à playlist</strong>
          {playlists.length ? playlists.map(playlist => (
            <button key={playlist.id} onClick={() => { onAddToPlaylist(playlist); setShowOptions(false); }}>
              {playlist.name}
            </button>
          )) : <span>Nenhuma playlist criada ainda.</span>}
        </div>
      )}

      <div className="hero-art"><Artwork track={current} large /></div>

      <div className="track-heading">
        <div>
          <h1>{current.title}</h1>
          <p>{current.artist}</p>
        </div>
        <button
          className={`icon-button icon-button--large ${isFavorite ? 'is-active' : ''}`}
          aria-label={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
          onClick={onToggleFavorite}
        >
          <Heart fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {autoplayBlocked && (
        <div className="autoplay-notice" role="status">
          O navegador bloqueou o play automático. Toque em Play uma vez para continuar.
        </div>
      )}

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
        <button className={`icon-button ${shuffle ? 'is-active' : ''}`} aria-label="Aleatório" aria-pressed={shuffle} onClick={onShuffle}><Shuffle /></button>
        <button className="icon-button icon-button--control" aria-label="Anterior" onClick={onPrevious}><SkipBack /></button>
        <button className="play-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="icon-button icon-button--control" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward /></button>
        <button
          className={`icon-button ${repeatMode !== 'off' ? 'is-active' : ''}`}
          aria-label={repeatMode === 'one' ? 'Repetir uma' : repeatMode === 'all' ? 'Repetir fila' : 'Repetição desligada'}
          onClick={onRepeat}
        >
          {repeatMode === 'one' ? <Repeat1 /> : <Repeat2 />}
        </button>
      </div>

      {!usesSystemVolume && (
        <div className="volume-control" aria-label="Controle de volume do player">
          <Volume2 aria-hidden="true" />
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={event => onVolume(Number(event.target.value))}
          />
          <span>{Math.round(volume * 100)}%</span>
        </div>
      )}

      <button className="library-toggle" onClick={onOpenLibrary}>
        <ListMusic />
        <span>{libraryReturnLabel}</span>
        <span className="library-toggle__count">{libraryReturnCount}</span>
      </button>

      <section className="queue-panel">
        <div className="queue-label">Fila · arraste ou use as setas</div>
        <div className="queue-list">
          {visibleQueue.map((track, visibleIndex) => {
            const queueIndex = visibleStart + visibleIndex;
            const isCurrent = track.id === current.id;
            return (
              <div
                className={`queue-item queue-item--reorder ${isCurrent ? 'is-current' : ''}`}
                key={track.id}
                draggable={!isCurrent}
                onDragStart={() => setDragFrom(queueIndex)}
                onDragOver={event => event.preventDefault()}
                onDrop={event => dropQueue(event, queueIndex)}
                onDragEnd={() => setDragFrom(null)}
              >
                <GripVertical className="queue-drag" aria-hidden="true" />
                <button className="queue-item__main" onClick={() => onPlayTrack(track, queue)}>
                  <Artwork track={track} />
                  <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
                </button>
                <div className="queue-reorder-buttons">
                  <button aria-label="Mover para cima" disabled={queueIndex === 0} onClick={() => onReorderQueue(queueIndex, queueIndex - 1)}><ChevronUp /></button>
                  <button aria-label="Mover para baixo" disabled={queueIndex === queue.length - 1} onClick={() => onReorderQueue(queueIndex, queueIndex + 1)}><ChevronDown /></button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
