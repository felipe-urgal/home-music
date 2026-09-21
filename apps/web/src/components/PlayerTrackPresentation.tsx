import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  ListMusic,
  LoaderCircle,
  MoreVertical,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  Wifi
} from 'lucide-react';
import type { Playlist, RepeatMode, Track } from '@home-music/shared';
import { useCrossfadeVisualState } from '../crossfade-visual';
import { NowPlayingCrossfadeIdentity, NowPlayingCrossfadeVinyl } from './NowPlayingCrossfade';

type PlayerTrackPresentationProps = {
  current: Track;
  playing: boolean;
  queueLength: number;
  libraryReturnLabel: string;
  playlists: Playlist[];
  offlineMode: boolean;
  isDownloaded: boolean;
  availableViaCollection: boolean;
  downloading: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  onOpenLibrary: () => void;
  onTogglePlay: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onToggleDownload?: () => void;
  onAddToPlaylist: (playlist: Playlist) => void;
  onExitOffline?: () => void;
};

export function PlayerTrackPresentation({
  current,
  playing,
  queueLength,
  libraryReturnLabel,
  playlists,
  offlineMode,
  isDownloaded,
  availableViaCollection,
  downloading,
  shuffle,
  repeatMode,
  onOpenLibrary,
  onTogglePlay,
  onShuffle,
  onRepeat,
  onToggleDownload,
  onAddToPlaylist,
  onExitOffline
}: PlayerTrackPresentationProps) {
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [showTrackMenu, setShowTrackMenu] = useState(false);
  const crossfadeVisual = useCrossfadeVisualState();
  const offlineActionLabel = downloading
    ? 'Baixando para uso offline'
    : isDownloaded
      ? availableViaCollection
        ? 'Remover download individual; a coleção manterá a música offline'
        : 'Remover download offline'
      : availableViaCollection
        ? 'Manter também como download individual'
        : 'Baixar para uso offline';

  useEffect(() => {
    setShowPlaylistPicker(false);
    setShowTrackMenu(false);
  }, [current.id, queueLength]);

  function togglePlaylistPicker() {
    setShowPlaylistPicker(value => !value);
    setShowTrackMenu(false);
  }

  return (
    <>
      <header className="topbar player-topbar">
        <button
          className="icon-button topbar__back-to-library"
          type="button"
          aria-label="Biblioteca"
          title={libraryReturnLabel}
          onClick={onOpenLibrary}
        >
          {offlineMode ? <ChevronDown aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
          {!offlineMode && <span className="topbar__back-label">Biblioteca</span>}
        </button>
        <span className="topbar__title">{offlineMode ? 'Tocando offline' : 'Tocando Agora'}</span>
        {offlineMode && onExitOffline ? (
          <button className="icon-button" type="button" aria-label="Tentar conectar ao servidor" onClick={onExitOffline}><Wifi aria-hidden="true" /></button>
        ) : (
          <button
            className="icon-button player-topbar__menu"
            type="button"
            aria-label="Mais opções da faixa"
            aria-haspopup="menu"
            aria-expanded={showTrackMenu}
            onClick={() => {
              setShowTrackMenu(value => !value);
              setShowPlaylistPicker(false);
            }}
          >
            <MoreVertical aria-hidden="true" />
          </button>
        )}
      </header>

      {showTrackMenu && !offlineMode && (
        <div className="player-track-menu" role="menu" aria-label="Mais opções da faixa">
          <button type="button" role="menuitem" onClick={togglePlaylistPicker}>
            <Heart aria-hidden="true" />
            <span>Adicionar à playlist</span>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={shuffle}
            onClick={() => {
              onShuffle();
              setShowTrackMenu(false);
            }}
          >
            <Shuffle aria-hidden="true" />
            <span>{shuffle ? 'Desativar aleatório' : 'Ativar aleatório'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onRepeat();
              setShowTrackMenu(false);
            }}
          >
            {repeatMode === 'one' ? <Repeat1 aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}
            <span>
              {repeatMode === 'one'
                ? 'Repetir uma'
                : repeatMode === 'all'
                  ? 'Repetir fila'
                  : 'Ativar repetição'}
            </span>
          </button>
          {onToggleDownload && (
            <button
              type="button"
              role="menuitem"
              disabled={downloading}
              onClick={() => {
                onToggleDownload();
                setShowTrackMenu(false);
              }}
            >
              {downloading
                ? <LoaderCircle className="download-spinner" aria-hidden="true" />
                : isDownloaded
                  ? <CheckCircle2 aria-hidden="true" />
                  : <Download aria-hidden="true" />}
              <span>{offlineActionLabel}</span>
            </button>
          )}
        </div>
      )}

      <div className="hero-art">
        {offlineMode ? (
          <NowPlayingCrossfadeVinyl
            current={current}
            crossfade={crossfadeVisual}
            playing={playing}
            offlineMode
          />
        ) : (
          <button
            className="player-hero-play"
            type="button"
            aria-label={playing ? 'Pausar pela capa' : 'Tocar pela capa'}
            onClick={onTogglePlay}
          >
            <NowPlayingCrossfadeVinyl
              current={current}
              crossfade={crossfadeVisual}
              playing={playing}
              offlineMode={false}
            />
            <span className="player-hero-play__control" aria-hidden="true">
              {playing ? <Pause /> : <Play />}
            </span>
          </button>
        )}
      </div>

      <div className="track-heading player-track-heading">
        <NowPlayingCrossfadeIdentity current={current} crossfade={crossfadeVisual} />
      </div>

      {!offlineMode && (
        <button
          className={`icon-button player-mobile-playlist-action ${showPlaylistPicker ? 'is-active' : ''}`}
          type="button"
          aria-label="Adicionar à playlist"
          aria-expanded={showPlaylistPicker}
          onClick={togglePlaylistPicker}
        >
          <Heart aria-hidden="true" />
        </button>
      )}

      {showPlaylistPicker && !offlineMode && (
        <section className="player-playlist-picker" aria-label="Escolher playlist">
          <strong>Adicionar à playlist</strong>
          {playlists.length ? playlists.map(playlist => (
            <button
              type="button"
              key={playlist.id}
              onClick={() => {
                onAddToPlaylist(playlist);
                setShowPlaylistPicker(false);
              }}
            >
              <ListMusic aria-hidden="true" />
              <span>{playlist.name}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          )) : <small>Nenhuma playlist criada ainda.</small>}
        </section>
      )}

      {offlineMode && <div className="player-offline-status"><Download aria-hidden="true" /> Reproduzindo o arquivo salvo neste dispositivo.</div>}
    </>
  );
}
