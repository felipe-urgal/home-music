import { useState, type CSSProperties } from 'react';
import type { Playlist, RepeatMode, Track } from '@home-music/shared';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2
} from 'lucide-react';
import { Artwork } from './Artwork';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

type DesktopNowPlayingScreenProps = {
  current: Track;
  playing: boolean;
  autoplayBlocked: boolean;
  playbackError?: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  playlists: Playlist[];
  isDownloaded?: boolean;
  downloading?: boolean;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onToggleDownload?: () => void;
  onAddToPlaylist: (playlist: Playlist) => void;
};

export function DesktopNowPlayingScreen({
  current,
  playing,
  autoplayBlocked,
  playbackError,
  currentTime,
  duration,
  volume,
  usesSystemVolume,
  shuffle,
  repeatMode,
  playlists,
  isDownloaded = false,
  downloading = false,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onShuffle,
  onRepeat,
  onToggleDownload,
  onAddToPlaylist
}: DesktopNowPlayingScreenProps) {
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const repeatLabel = repeatMode === 'one'
    ? 'Repetir uma'
    : repeatMode === 'all'
      ? 'Repetir fila'
      : 'Repetição desligada';

  return (
    <section className="desktop-now-playing-screen" aria-labelledby="desktop-now-playing-title">
      <header className="desktop-now-playing-screen__header">
        <strong>Tocando agora</strong>
      </header>

      <div className="desktop-now-playing-screen__stage">
        <div className="desktop-now-playing-screen__art">
          <Artwork track={current} large />
        </div>

        <div className="desktop-now-playing-screen__content">
          <div className="desktop-now-playing-screen__heading">
            <h1 id="desktop-now-playing-title">{current.title}</h1>
            <p>{current.artist || 'Artista desconhecido'}</p>
          </div>

          <div className="desktop-now-playing-screen__actions" aria-label="Ações da faixa">
            {onToggleDownload && (
              <button
                className={isDownloaded ? 'is-active' : ''}
                type="button"
                disabled={downloading}
                aria-label={downloading ? 'Baixando para uso offline' : isDownloaded ? 'Remover download offline' : 'Baixar para uso offline'}
                onClick={onToggleDownload}
              >
                {downloading ? <LoaderCircle className="desktop-now-playing-screen__spinner" /> : isDownloaded ? <CheckCircle2 /> : <Download />}
                <span>Download</span>
              </button>
            )}

            <div className="desktop-now-playing-screen__playlist">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={playlistOpen}
                onClick={() => setPlaylistOpen(open => !open)}
              >
                <Plus />
                <span>Adicionar</span>
                <ChevronDown className="desktop-now-playing-screen__chevron" />
              </button>

              {playlistOpen && (
                <div className="desktop-now-playing-screen__playlist-menu" role="menu" aria-label="Adicionar à playlist">
                  <strong>Adicionar à playlist</strong>
                  {playlists.length ? playlists.map(playlist => (
                    <button
                      key={playlist.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onAddToPlaylist(playlist);
                        setPlaylistOpen(false);
                      }}
                    >
                      {playlist.name}
                    </button>
                  )) : <span>Nenhuma playlist criada ainda.</span>}
                </div>
              )}
            </div>
          </div>

          {autoplayBlocked && (
            <div className="desktop-now-playing-screen__notice" role="status">
              O navegador bloqueou o play automático. Clique em Play uma vez para continuar.
            </div>
          )}
          {playbackError && <div className="desktop-now-playing-screen__notice is-error" role="alert">{playbackError}</div>}

          <div className="desktop-now-playing-screen__progress">
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
            <div>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="desktop-now-playing-screen__controls" aria-label="Controles de reprodução">
            <button className={shuffle ? 'is-active' : ''} type="button" aria-label="Aleatório" title="Aleatório" aria-pressed={shuffle} onClick={onShuffle}><Shuffle style={{ fill: 'none' }} /></button>
            <button type="button" aria-label="Anterior" onClick={onPrevious}><SkipBack /></button>
            <button className="desktop-now-playing-screen__play" type="button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>
              {playing ? <Pause /> : <Play />}
            </button>
            <button type="button" aria-label="Próxima" onClick={onNext}><SkipForward /></button>
            <button className={repeatMode !== 'off' ? 'is-active' : ''} type="button" aria-label={repeatLabel} title={repeatLabel} onClick={onRepeat}>
              {repeatMode === 'one' ? <Repeat1 style={{ fill: 'none' }} /> : <Repeat2 style={{ fill: 'none' }} />}
            </button>
          </div>

          {!usesSystemVolume && (
            <div className="desktop-now-playing-screen__volume">
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
        </div>
      </div>
    </section>
  );
}
