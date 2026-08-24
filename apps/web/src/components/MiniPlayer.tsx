import { Pause, Play, SkipForward } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { Artwork } from './Artwork';

type MiniPlayerProps = {
  current: Track;
  playing: boolean;
  hasNext: boolean;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
};

export function MiniPlayer({ current, playing, hasNext, onOpenPlayer, onTogglePlay, onNext }: MiniPlayerProps) {
  return (
    <div className="mini-player">
      <button className="mini-player__main" onClick={onOpenPlayer}>
        <Artwork track={current} />
        <span className="mini-player__text"><strong>{current.title}</strong><small>{current.artist}</small></span>
      </button>
      <button className="icon-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>{playing ? <Pause /> : <Play />}</button>
      <button className="icon-button" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward /></button>
    </div>
  );
}
