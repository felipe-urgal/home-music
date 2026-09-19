import { useState, type CSSProperties } from 'react';
import type { Playlist, RepeatMode, Track } from '@home-music/shared';
import {
  AudioLines,
  CheckCircle2,
  Download,
  Heart,
  LoaderCircle,
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
import { useCrossfadeVisualState } from '../crossfade-visual';
import { LyricsPanel } from './LyricsPanel';
import { NowPlayingCrossfadeIdentity, NowPlayingCrossfadeVinyl } from './NowPlayingCrossfade';

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

type ImmersiveStyle = CSSProperties & {
  '--now-playing-artwork'?: string;
};

type WaveStyle = CSSProperties & {
  '--wave-height'?: string;
};

const WAVEFORM_HEIGHTS = [
  14, 22, 34, 48, 61, 72, 82, 68, 51, 38, 57, 76, 92, 69, 45, 31, 54, 73, 87, 65,
  50, 34, 24, 18, 30, 42, 55, 46, 36, 27, 21, 16, 12, 9, 7, 5, 4, 3
];

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
  availableViaCollection?: boolean;
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
  availableViaCollection = false,
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const crossfadeVisual = useCrossfadeVisualState();
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const playedWaveBars = Math.round((progress / 100) * WAVEFORM_HEIGHTS.length);
  const repeatLabel = repeatMode === 'one'
    ? 'Repetir uma'
    : repeatMode === 'all'
      ? 'Repetir fila'
      : 'Repetição desligada';
  const offlineActionLabel = downloading
    ? 'Baixando para uso offline'
    : isDownloaded
      ? availableViaCollection
        ? 'Remover download individual; a coleção manterá a música offline'
        : 'Remover download offline'
      : availableViaCollection
        ? 'Manter também como download individual'
        : 'Baixar para uso offline';
  const coverVersion = current.coverVersion ? `?v=${encodeURIComponent(current.coverVersion)}` : '';
  const coverUrl = current.hasCover ? `/api/tracks/${encodeURIComponent(current.id)}/cover${coverVersion}` : null;
  const immersiveStyle: ImmersiveStyle | undefined = coverUrl
    ? { '--now-playing-artwork': `url("${coverUrl}")` }
    : undefined;

  return (
    <section
      className="desktop-now-playing-screen"
      aria-labelledby="desktop-now-playing-title"
      style={immersiveStyle}
      data-has-artwork={coverUrl ? 'true' : 'false'}
    >
      <div className="desktop-now-playing-screen__backdrop" aria-hidden="true" />

      <div className="desktop-now-playing-screen__stage">
        <div className="desktop-now-playing-screen__art">
          <NowPlayingCrossfadeVinyl
            current={current}
            crossfade={crossfadeVisual}
            playing={playing}
          />
        </div>

        <div className="desktop-now-playing-screen__content">
          <div className="desktop-now-playing-screen__identity-row">
            <div className="desktop-now-playing-screen__heading">
              <NowPlayingCrossfadeIdentity
                current={current}
                crossfade={crossfadeVisual}
                titleId="desktop-now-playing-title"
              />
            </div>

            <div className="desktop-now-playing-screen__actions" aria-label="Ações da faixa">
              <div className="desktop-now-playing-screen__playlist">
                <button
                  className={`desktop-now-playing-screen__favorite ${playlistOpen ? 'is-active' : ''}`}
                  type="button"
                  aria-label="Adicionar à playlist"
                  aria-haspopup="menu"
                  aria-expanded={playlistOpen}
                  onClick={() => {
                    setPlaylistOpen(value => !value);
                    setActionsOpen(false);
                  }}
                >
                  <Heart aria-hidden="true" />
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

              <div className="desktop-now-playing-screen__more-wrap">
                <button
                  className="desktop-now-playing-screen__more"
                  type="button"
                  aria-label="Mais opções da faixa"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  onClick={() => {
                    setActionsOpen(value => !value);
                    setPlaylistOpen(false);
                  }}
                >
                  <MoreVertical aria-hidden="true" />
                </button>
                {actionsOpen && (
                  <div className="desktop-now-playing-screen__more-menu" role="menu" aria-label="Mais opções da faixa">
                    {onToggleDownload && (
                      <button
                        type="button"
                        role="menuitem"
                        disabled={downloading}
                        onClick={() => {
                          onToggleDownload();
                          setActionsOpen(false);
                        }}
                      >
                        {downloading
                          ? <LoaderCircle className="desktop-now-playing-screen__spinner" aria-hidden="true" />
                          : isDownloaded
                            ? <CheckCircle2 aria-hidden="true" />
                            : <Download aria-hidden="true" />}
                        <span>{offlineActionLabel}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="desktop-now-playing-screen__waveform" aria-hidden="true">
            {WAVEFORM_HEIGHTS.map((height, index) => (
              <span
                key={index}
                className={index < playedWaveBars ? 'is-played' : ''}
                style={{ '--wave-height': `${height}%` } as WaveStyle}
              />
            ))}
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

          <LyricsPanel track={current} currentTime={currentTime} offlineMode={false} />
        </div>
      </div>

      <div className="desktop-now-playing-screen__quote" aria-hidden="true">
        <span>Boa música</span>
        <strong>torna tudo mais leve.</strong>
      </div>
      <div className="desktop-now-playing-screen__signature" aria-hidden="true">
        <span>Qualidade de vida em forma de som.</span>
        <AudioLines />
      </div>
    </section>
  );
}
