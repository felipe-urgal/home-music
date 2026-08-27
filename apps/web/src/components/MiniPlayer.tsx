import { Pause, Play, SkipForward } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { useDesktopLayout } from '../useDesktopLayout';
import { Artwork } from './Artwork';

type MiniPlayerProps = {
  current: Track;
  playing: boolean;
  hasNext: boolean;
  currentTime?: number;
  duration?: number;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
};

export function MiniPlayer({
  current,
  playing,
  hasNext,
  currentTime = 0,
  duration = 0,
  onOpenPlayer,
  onTogglePlay,
  onNext
}: MiniPlayerProps) {
  const desktopLayout = useDesktopLayout();
  if (desktopLayout) return null;

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="mini-player" data-testid="mini-player">
      <div className="mini-player__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <button className="mini-player__main" onClick={onOpenPlayer}>
        <Artwork track={current} />
        <span className="mini-player__text"><strong>{current.title}</strong><small>{current.artist}</small></span>
      </button>
      <button className="icon-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>{playing ? <Pause /> : <Play />}</button>
      <button className="icon-button" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward /></button>
    </div>
  );
}
