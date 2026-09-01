import type { CSSProperties } from 'react';
import {
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2
} from 'lucide-react';
import type { RepeatMode } from '@home-music/shared';
import { formatPlayerTime } from '../player-presentation';

type PlayerPlaybackControlsProps = {
  queueLength: number;
  currentIndex: number;
  playing: boolean;
  autoplayBlocked: boolean;
  playbackError?: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
};

export function PlayerPlaybackControls({
  queueLength,
  currentIndex,
  playing,
  autoplayBlocked,
  playbackError,
  currentTime,
  duration,
  volume,
  usesSystemVolume,
  shuffle,
  repeatMode,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onShuffle,
  onRepeat
}: PlayerPlaybackControlsProps) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const hasNext = currentIndex < queueLength - 1 || repeatMode === 'all';

  return (
    <>
      {autoplayBlocked && (
        <div className="autoplay-notice" role="status">
          O navegador bloqueou o play automático. Toque em Play uma vez para continuar.
        </div>
      )}

      {playbackError && <div className="autoplay-notice" role="alert">{playbackError}</div>}

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
        <div className="time-row"><span>{formatPlayerTime(currentTime)}</span><span>{formatPlayerTime(duration)}</span></div>
      </div>

      <div className="controls">
        <button className={`icon-button ${shuffle ? 'is-active' : ''}`} type="button" aria-label="Aleatório" aria-pressed={shuffle} onClick={onShuffle}><Shuffle aria-hidden="true" /></button>
        <button className="icon-button icon-button--control" type="button" aria-label="Anterior" onClick={onPrevious}><SkipBack aria-hidden="true" /></button>
        <button className="play-button" type="button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <button className="icon-button icon-button--control" type="button" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward aria-hidden="true" /></button>
        <button
          className={`icon-button ${repeatMode !== 'off' ? 'is-active' : ''}`}
          type="button"
          aria-label={repeatMode === 'one' ? 'Repetir uma' : repeatMode === 'all' ? 'Repetir fila' : 'Repetição desligada'}
          aria-pressed={repeatMode !== 'off'}
          onClick={onRepeat}
        >
          {repeatMode === 'one' ? <Repeat1 aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}
        </button>
      </div>

      {!usesSystemVolume && (
        <div className="volume-control">
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
    </>
  );
}