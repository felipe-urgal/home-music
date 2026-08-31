import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ListMusic,
  ListPlus,
  LoaderCircle,
  Wifi
} from 'lucide-react';
import type { Playlist, Track } from '@home-music/shared';
import { playerArtworkTrack } from '../player-presentation';
import { Artwork } from './Artwork';

type PlayerTrackPresentationProps = {
  current: Track;
  queueLength: number;
  libraryReturnLabel: string;
  playlists: Playlist[];
  offlineMode: boolean;
  isDownloaded: boolean;
  downloading: boolean;
  onOpenLibrary: () => void;
  onToggleDownload?: () => void;
  onAddToPlaylist: (playlist: Playlist) => void;
  onExitOffline?: () => void;
};

export function PlayerTrackPresentation({
  current,
  queueLength,
  libraryReturnLabel,
  playlists,
  offlineMode,
  isDownloaded,
  downloading,
  onOpenLibrary,
  onToggleDownload,
  onAddToPlaylist,
  onExitOffline
}: PlayerTrackPresentationProps) {
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);

  useEffect(() => {
    setShowPlaylistPicker(false);
  }, [current.id, queueLength]);

  return (
    <>
      <header className="topbar">
        <button className="icon-button topbar__back-to-library" aria-label={libraryReturnLabel} title={libraryReturnLabel} onClick={onOpenLibrary}>
          <ChevronDown />
        </button>
        <span className="topbar__title">{offlineMode ? 'Tocando offline' : 'Tocando agora'}</span>
        {offlineMode && onExitOffline
          ? <button className="icon-button" aria-label="Tentar conectar ao servidor" onClick={onExitOffline}><Wifi /></button>
          : <span aria-hidden="true" />}
      </header>

      <div className="hero-art"><Artwork track={playerArtworkTrack(current, offlineMode)} large /></div>

      <div className="track-heading">
        <div>
          <h1>{current.title}</h1>
          <p>{current.artist}</p>
        </div>
        <div className="track-heading__actions">
          {!offlineMode && (
            <button
              className={`icon-button icon-button--large ${showPlaylistPicker ? 'is-active' : ''}`}
              type="button"
              aria-label="Adicionar à playlist"
              aria-expanded={showPlaylistPicker}
              onClick={() => setShowPlaylistPicker(value => !value)}
            >
              <ListPlus />
            </button>
          )}
          {!offlineMode && onToggleDownload && (
            <button
              className={`icon-button icon-button--large ${isDownloaded ? 'is-downloaded' : ''}`}
              aria-label={downloading ? 'Baixando para uso offline' : isDownloaded ? 'Remover download offline' : 'Baixar para uso offline'}
              disabled={downloading}
              onClick={onToggleDownload}
            >
              {downloading ? <LoaderCircle className="download-spinner" /> : isDownloaded ? <CheckCircle2 /> : <Download />}
            </button>
          )}
        </div>
      </div>

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

      {offlineMode && <div className="player-offline-status"><Download /> Reproduzindo o arquivo salvo neste dispositivo.</div>}
    </>
  );
}
