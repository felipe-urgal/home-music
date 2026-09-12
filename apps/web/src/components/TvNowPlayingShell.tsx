import type { Track } from '@home-music/shared';
import { Pause, Play, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { Artwork } from './Artwork';

type Props = {
  current?: Track;
  playing: boolean;
  shuffle: boolean;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onShuffle: () => void;
};

export function TvNowPlayingShell({ current, playing, shuffle, onTogglePlay, onPrevious, onNext, onShuffle }: Props) {
  return (
    <section className="tv-now-playing-shell">
      <Artwork track={current} large />
      <h1>{current?.title || 'Nada tocando'}</h1>
      <p>{current?.albumArtist || current?.artist || 'Use o celular para escolher uma música'}</p>
      <div>
        <button type="button" aria-label="Aleatório" aria-pressed={shuffle} onClick={onShuffle}><Shuffle /></button>
        <button type="button" aria-label="Faixa anterior" onClick={onPrevious}><SkipBack /></button>
        <button type="button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>{playing ? <Pause /> : <Play />}</button>
        <button type="button" aria-label="Próxima faixa" onClick={onNext}><SkipForward /></button>
      </div>
    </section>
  );
}
