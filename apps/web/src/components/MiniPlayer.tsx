import { useState } from 'react';
import { Heart, ListMusic, Pause, Play, SkipForward } from 'lucide-react';
import type { Playlist, Track } from '@home-music/shared';
import { useDesktopLayout } from '../useDesktopLayout';
import { Artwork } from './Artwork';

type MiniPlayerProps = {
  current: Track;
  playing: boolean;
  hasNext: boolean;
  currentTime?: number;
  duration?: number;
  playlists?: Playlist[];
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onAddToPlaylist?: (playlist: Playlist) => void;
};

export function MiniPlayer({
  current,
  playing,
  hasNext,
  currentTime = 0,
  duration = 0,
  playlists = [],
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onAddToPlaylist
}: MiniPlayerProps) {
  const desktopLayout = useDesktopLayout();
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  if (desktopLayout) return null;

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="mini-player" data-testid="mini-player">
      <div className="mini-player__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <button className="mini-player__main" type="button" aria-label="Abrir Tocando Agora" onClick={onOpenPlayer}>
        <Artwork track={current} />
        <span className="mini-player__text"><strong>{current.title}</strong><small>{current.artist}</small></span>
      </button>
      {onAddToPlaylist && (
        <button
          className="icon-button mini-player__playlist"
          type="button"
          aria-label="Adicionar à playlist"
          aria-expanded={playlistPickerOpen}
          onClick={() => setPlaylistPickerOpen(open => !open)}
        >
          <Heart aria-hidden="true" />
        </button>
      )}
      <button className="icon-button mini-player__next" type="button" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward /></button>
      <button className="icon-button mini-player__toggle" type="button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>{playing ? <Pause /> : <Play />}</button>

      {playlistPickerOpen && onAddToPlaylist && (
        <section className="mini-player__playlist-picker" aria-label="Escolher playlist">
          <strong>Adicionar à playlist</strong>
          {playlists.length ? playlists.map(playlist => (
            <button
              type="button"
              key={playlist.id}
              onClick={() => {
                onAddToPlaylist(playlist);
                setPlaylistPickerOpen(false);
              }}
            >
              <ListMusic aria-hidden="true" />
              <span>{playlist.name}</span>
            </button>
          )) : <small>Nenhuma playlist criada ainda.</small>}
        </section>
      )}
    </div>
  );
}
