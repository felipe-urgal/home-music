import { useState, type CSSProperties } from 'react';
import type { Playlist, RepeatMode, Track } from '@home-music/shared';
import {
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
  SkipForward,
  Volume2
} from 'lucide-react';
import { useCrossfadeVisualState } from '../crossfade-visual';
import { Artwork } from './Artwork';
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
  '--wave-fill'?: string;
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
  nextTrack?: Track;
  isDownloaded?: boolean;
  availableViaCollection?: boolean;
  downloading?: boolean;
  onTogglePlay: () => void;
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
  nextTrack,
  isDownloaded = false,
  availableViaCollection = false,
  downloading = false,
  onTogglePlay,
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
  const progress = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const waveformPosition = (progress / 100) * WAVEFORM_HEIGHTS.length;
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
          <div className="desktop-now-playing-screen__art-frame">
            <NowPlayingCrossfadeVinyl
              current={current}
              crossfade={crossfadeVisual}
              playing={playing}
            />
            <button
              className="desktop-now-playing-screen__cover-play"
              type="button"
              aria-label={playing ? 'Pausar' : 'Tocar'}
              title={playing ? 'Pausar' : 'Tocar'}
              onClick={onTogglePlay}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
          </div>
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
              <div className="desktop-now-playing-screen__more-wrap">
                <button
                  className="desktop-now-playing-screen__more"
                  type="button"
                  aria-label="Mais opções da faixa"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  onClick={() => {
                    setActionsOpen(value => {
                      if (value) setPlaylistOpen(false);
                      return !value;
                    });
                  }}
                >
                  <MoreVertical aria-hidden="true" />
                </button>
                {actionsOpen && (
                  <div className="desktop-now-playing-screen__more-menu" role="menu" aria-label="Mais opções da faixa">
                    <button
                      type="button"
                      role="menuitem"
                      aria-haspopup="true"
                      aria-expanded={playlistOpen}
                      onClick={() => setPlaylistOpen(value => !value)}
                    >
                      <Heart aria-hidden="true" />
                      <span>Adicionar à playlist</span>
                    </button>

                    {playlistOpen && (
                      <div className="desktop-now-playing-screen__more-submenu" role="group" aria-label="Adicionar à playlist">
                        {playlists.length ? playlists.map(playlist => (
                          <button
                            key={playlist.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              onAddToPlaylist(playlist);
                              setPlaylistOpen(false);
                              setActionsOpen(false);
                            }}
                          >
                            <span>{playlist.name}</span>
                          </button>
                        )) : <span className="desktop-now-playing-screen__more-empty">Nenhuma playlist criada ainda.</span>}
                      </div>
                    )}

                    <button
                      className={shuffle ? 'is-active' : ''}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={shuffle}
                      onClick={() => {
                        onShuffle();
                        setActionsOpen(false);
                      }}
                    >
                      <Shuffle aria-hidden="true" style={{ fill: 'none' }} />
                      <span>{shuffle ? 'Aleatório ligado' : 'Aleatório'}</span>
                    </button>

                    <button
                      className={repeatMode !== 'off' ? 'is-active' : ''}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onRepeat();
                        setActionsOpen(false);
                      }}
                    >
                      {repeatMode === 'one'
                        ? <Repeat1 aria-hidden="true" style={{ fill: 'none' }} />
                        : <Repeat2 aria-hidden="true" style={{ fill: 'none' }} />}
                      <span>{repeatLabel}</span>
                    </button>

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

          <div className="desktop-now-playing-screen__waveform-progress">
            <div className="desktop-now-playing-screen__waveform" aria-hidden="true">
              {WAVEFORM_HEIGHTS.map((height, index) => {
                const fill = Math.max(0, Math.min(100, (waveformPosition - index) * 100));
                return (
                  <span
                    key={index}
                    style={{
                      '--wave-height': `${height}%`,
                      '--wave-fill': `${fill}%`
                    } as WaveStyle}
                  />
                );
              })}
            </div>
            <input
              className="desktop-now-playing-screen__waveform-seek"
              aria-label="Progresso da música"
              aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`}
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              disabled={duration <= 0}
              onChange={event => onSeek(Number(event.target.value))}
            />
            <div className="desktop-now-playing-screen__waveform-time" aria-hidden="true">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {autoplayBlocked && (
            <div className="desktop-now-playing-screen__notice" role="status">
              O navegador bloqueou o play automático. Clique em Play uma vez para continuar.
            </div>
          )}
          {playbackError && <div className="desktop-now-playing-screen__notice is-error" role="alert">{playbackError}</div>}

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
      {nextTrack && nextTrack.id !== current.id && (
        <button
          className="desktop-now-playing-screen__next-track"
          type="button"
          aria-label={`Tocar próxima: ${nextTrack.title}`}
          onClick={onNext}
        >
          <Artwork track={nextTrack} />
          <span className="desktop-now-playing-screen__next-track-copy">
            <small>Próxima música</small>
            <strong>{nextTrack.title}</strong>
            <span>{nextTrack.artist || 'Artista desconhecido'}</span>
          </span>
          <SkipForward aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
