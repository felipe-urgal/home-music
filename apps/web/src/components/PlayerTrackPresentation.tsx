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
import { MobileSheet } from './MobileSheet';
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
  const [showHeroControl, setShowHeroControl] = useState(true);
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
    setShowHeroControl(true);
  }, [current.id, queueLength]);

  useEffect(() => {
    if (!playing) {
      setShowHeroControl(true);
      return;
    }

    setShowHeroControl(true);
    const timeout = window.setTimeout(() => setShowHeroControl(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [playing, current.id]);

  function openPlaylistPicker() {
    setShowTrackMenu(false);
    setShowPlaylistPicker(true);
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
            aria-haspopup="dialog"
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

      <MobileSheet
        open={showTrackMenu && !offlineMode}
        title="Opções da faixa"
        onClose={() => setShowTrackMenu(false)}
        className="player-actions-sheet"
      >
        <div className="mobile-sheet-actions">
          <button type="button" onClick={openPlaylistPicker}>
            <Heart aria-hidden="true" />
            <span>Adicionar à playlist</span>
            <ChevronRight aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={shuffle}
            onClick={() => {
              onShuffle();
              setShowTrackMenu(false);
            }}
          >
            <Shuffle aria-hidden="true" />
            <span>{shuffle ? 'Desativar aleatório' : 'Ativar aleatório'}</span>
            <span aria-hidden="true" />
          </button>
          <button
            type="button"
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
            <span aria-hidden="true" />
          </button>
          {onToggleDownload && (
            <button
              type="button"
              disabled={downloading}
              onClick={() => {
                setShowTrackMenu(false);
                onToggleDownload();
              }}
            >
              {downloading
                ? <LoaderCircle className="download-spinner" aria-hidden="true" />
                : isDownloaded
                  ? <CheckCircle2 aria-hidden="true" />
                  : <Download aria-hidden="true" />}
              <span>{offlineActionLabel}</span>
              <span aria-hidden="true" />
            </button>
          )}
        </div>
      </MobileSheet>

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
            onPointerDown={() => setShowHeroControl(true)}
            onClick={() => {
              setShowHeroControl(true);
              onTogglePlay();
            }}
          >
            <NowPlayingCrossfadeVinyl
              current={current}
              crossfade={crossfadeVisual}
              playing={playing}
              offlineMode={false}
            />
            <span
              className={`player-hero-play__control ${showHeroControl ? 'is-visible' : 'is-hidden'}`}
              aria-hidden="true"
            >
              {playing ? <Pause /> : <Play />}
            </span>
          </button>
        )}
      </div>

      <div className="track-heading player-track-heading">
        <NowPlayingCrossfadeIdentity current={current} crossfade={crossfadeVisual} />
      </div>

      <MobileSheet
        open={showPlaylistPicker && !offlineMode}
        title="Adicionar à playlist"
        onClose={() => setShowPlaylistPicker(false)}
        className="player-playlist-sheet"
      >
        {playlists.length ? (
          <div className="mobile-sheet-actions">
            {playlists.map(playlist => (
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
            ))}
          </div>
        ) : <small className="mobile-sheet-empty">Nenhuma playlist criada ainda.</small>}
      </MobileSheet>

      {offlineMode && <div className="player-offline-status"><Download aria-hidden="true" /> Reproduzindo o arquivo salvo neste dispositivo.</div>}
    </>
  );
}
