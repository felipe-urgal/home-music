import type { Track } from '@home-music/shared';
import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useDesktopKeyboardShortcuts } from '../useDesktopKeyboardShortcuts';
import { useDesktopLayout } from '../useDesktopLayout';
import { Artwork } from './Artwork';

type DesktopPlayerBarProps = {
  current?: Track | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  hasNext: boolean;
  offlineMode?: boolean;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function artworkTrack(track: Track, offlineMode: boolean): Track {
  return offlineMode && track.hasCover ? { ...track, hasCover: false } : track;
}

export function DesktopPlayerBar({
  current,
  playing,
  currentTime,
  duration,
  volume,
  usesSystemVolume,
  hasNext,
  offlineMode = false,
  onOpenPlayer,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume
}: DesktopPlayerBarProps) {
  const desktopLayout = useDesktopLayout();
  const maxDuration = Math.max(duration, 1);
  const safeCurrentTime = duration > 0 ? Math.min(Math.max(currentTime, 0), duration) : 0;

  useDesktopKeyboardShortcuts({
    enabled: desktopLayout,
    hasCurrent: Boolean(current),
    hasNext,
    currentTime,
    duration,
    volume,
    usesSystemVolume,
    onTogglePlay,
    onPrevious,
    onNext,
    onSeek,
    onVolume
  });

  return (
    <footer className="desktop-player-bar" data-testid="desktop-player-bar" aria-label="Player persistente">
      <button
        className="desktop-player-bar__track"
        type="button"
        onClick={onOpenPlayer}
        disabled={!current}
        aria-label={current ? `Abrir ${current.title} no player` : 'Nenhuma faixa selecionada'}
      >
        {current ? (
          <Artwork track={artworkTrack(current, offlineMode)} />
        ) : (
          <span className="desktop-player-bar__artwork-placeholder" aria-hidden="true" />
        )}
        <span className="desktop-player-bar__track-text">
          <strong>{current?.title || 'Nenhuma faixa selecionada'}</strong>
          <small>{current?.artist || (current ? 'Artista desconhecido' : 'Escolha uma música na biblioteca')}</small>
        </span>
      </button>

      <div className="desktop-player-bar__transport">
        <div className="desktop-player-bar__buttons">
          <button type="button" onClick={onPrevious} disabled={!current} aria-label="Anterior na barra desktop">
            <SkipBack />
          </button>
          <button
            className="desktop-player-bar__play"
            type="button"
            onClick={onTogglePlay}
            disabled={!current}
            aria-label={playing ? 'Pausar na barra desktop' : 'Tocar na barra desktop'}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button type="button" onClick={onNext} disabled={!current || !hasNext} aria-label="Próxima na barra desktop">
            <SkipForward />
          </button>
        </div>

        <div className="desktop-player-bar__progress">
          <span>{formatTime(safeCurrentTime)}</span>
          <input
            type="range"
            min="0"
            max={maxDuration}
            step="0.1"
            value={safeCurrentTime}
            disabled={!current || duration <= 0}
            aria-label="Progresso da reprodução na barra desktop"
            onChange={event => onSeek(Number(event.currentTarget.value))}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="desktop-player-bar__volume">
        <Volume2 aria-hidden="true" />
        {usesSystemVolume ? (
          <span>Volume do sistema</span>
        ) : (
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            disabled={!current}
            aria-label="Volume na barra desktop"
            onChange={event => onVolume(Number(event.currentTarget.value))}
          />
        )}
      </div>
    </footer>
  );
}
