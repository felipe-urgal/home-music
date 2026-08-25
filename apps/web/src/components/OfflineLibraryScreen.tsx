import { Download, Music2, Play, Trash2, Wifi } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { formatOfflineBytes, type OfflineDownloadRecord } from '../offline-downloads';
import { Artwork } from './Artwork';
import { MiniPlayer } from './MiniPlayer';

type OfflineLibraryScreenProps = {
  records: OfflineDownloadRecord[];
  current?: Track;
  playing: boolean;
  hasNext: boolean;
  totalBytes: number;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onRemove: (trackId: string) => void;
  onExitOffline: () => void;
};

function fallbackTrack(track: Track): Track {
  return track.hasCover ? { ...track, hasCover: false } : track;
}

export function OfflineLibraryScreen({
  records,
  current,
  playing,
  hasNext,
  totalBytes,
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onPlayTrack,
  onRemove,
  onExitOffline
}: OfflineLibraryScreenProps) {
  const tracks = records.map(record => record.track);

  return (
    <>
      <header className="offline-header">
        <span className="offline-header__icon"><Download /></span>
        <div className="offline-header__title">
          <strong>Downloads offline</strong>
          <small>{records.length} músicas · {formatOfflineBytes(totalBytes)}</small>
        </div>
        <button className="icon-button" aria-label="Tentar conectar ao servidor" onClick={onExitOffline}><Wifi /></button>
      </header>

      <div className="offline-banner" role="status">
        <Download />
        <span>Modo offline. Somente músicas salvas neste dispositivo estão disponíveis.</span>
      </div>

      <section className="library-content">
        <div className="section-heading"><span>Músicas baixadas</span><small>{records.length}</small></div>
        <div className="library-track-list">
          {records.map(record => {
            const track = record.track;
            const isCurrent = track.id === current?.id;
            return (
              <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
                <button className="library-track__main" onClick={() => onPlayTrack(track, tracks)}>
                  <Artwork track={fallbackTrack(track)} />
                  <span className="library-track__text">
                    <strong>{track.title}</strong>
                    <small>{track.artist} · {formatOfflineBytes(record.size)}</small>
                  </span>
                  {isCurrent && playing ? <span className="playing-indicator">▶</span> : <Play className="library-track__action" />}
                </button>
                <button
                  className="track-action"
                  aria-label={`Remover download de ${track.title}`}
                  onClick={() => {
                    if (window.confirm(`Remover “${track.title}” dos downloads offline?`)) onRemove(track.id);
                  }}
                >
                  <Trash2 />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {current && (
        <MiniPlayer
          current={fallbackTrack(current)}
          playing={playing}
          hasNext={hasNext}
          onOpenPlayer={onOpenPlayer}
          onTogglePlay={onTogglePlay}
          onNext={onNext}
        />
      )}

      {!records.length && (
        <div className="center-state center-state--actions" role="status">
          <Music2 />
          <strong>Nenhum download offline</strong>
          <span>Conecte ao Home Music e baixe uma música pelo player.</span>
          <button className="secondary-action" onClick={onExitOffline}>Tentar conectar</button>
        </div>
      )}
    </>
  );
}
