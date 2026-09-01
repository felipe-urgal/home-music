import { Download, Folder, ListMusic, Play, Trash2, Wifi } from 'lucide-react';
import type { Track } from '@home-music/shared';
import type { OfflineCollectionKind } from '../offline-collection-references';
import {
  formatOfflineBytes,
  type OfflineCollectionSummary,
  type OfflineDownloadRecord
} from '../offline-downloads';
import { Artwork } from './Artwork';
import { MiniPlayer } from './MiniPlayer';
import { ResponsiveState } from './ResponsiveState';

type OfflineLibraryScreenProps = {
  records: OfflineDownloadRecord[];
  collections: OfflineCollectionSummary[];
  individualTrackIds: ReadonlySet<string>;
  current?: Track;
  playing: boolean;
  hasNext: boolean;
  totalBytes: number;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onRemove: (trackId: string) => void;
  onRemoveCollection: (kind: OfflineCollectionKind, sourceId: string) => void;
  onExitOffline: () => void;
};

function fallbackTrack(track: Track): Track {
  return track.hasCover ? { ...track, hasCover: false } : track;
}

function collectionStatusLabel(collection: OfflineCollectionSummary) {
  if (collection.status === 'available') return 'Disponível';
  if (collection.status === 'partial') return 'Parcial';
  if (collection.status === 'paused') return 'Pausada';
  if (collection.status === 'error') return 'Com erro';
  if (collection.status === 'downloading') return 'Baixando';
  return 'Pendente';
}

export function OfflineLibraryScreen({
  records,
  collections,
  individualTrackIds,
  current,
  playing,
  hasNext,
  totalBytes,
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onPlayTrack,
  onRemove,
  onRemoveCollection,
  onExitOffline
}: OfflineLibraryScreenProps) {
  const recordsById = new Map(records.map(record => [record.track.id, record]));
  const individualRecords = records.filter(record => individualTrackIds.has(record.track.id));

  return (
    <>
      <header className="offline-header">
        <span className="offline-header__icon"><Download aria-hidden="true" /></span>
        <div className="offline-header__title">
          <strong>Downloads offline</strong>
          <small>{records.length} músicas · {formatOfflineBytes(totalBytes)} físicos</small>
        </div>
        <button className="icon-button" type="button" aria-label="Tentar conectar ao servidor" onClick={onExitOffline}><Wifi aria-hidden="true" /></button>
      </header>

      <div className="offline-banner" role="status">
        <Download aria-hidden="true" />
        <span>Modo offline. O espaço acima conta cada música física uma única vez, mesmo quando ela pertence a várias coleções.</span>
      </div>

      {collections.length > 0 && (
        <section className="library-content offline-collections-section">
          <div className="section-heading"><span>Coleções offline</span><small>{collections.length}</small></div>
          <div className="offline-collection-list">
            {collections.map(collection => {
              const availableRecords = collection.reference.trackIds
                .map(trackId => recordsById.get(trackId))
                .filter((record): record is OfflineDownloadRecord => Boolean(record));
              const availableTracks = availableRecords.map(record => record.track);
              const first = availableTracks[0];
              const CollectionIcon = collection.reference.kind === 'playlist' ? ListMusic : Folder;

              return (
                <article className="offline-collection-card" key={collection.key}>
                  <button
                    className="offline-collection-card__main"
                    type="button"
                    disabled={!first}
                    onClick={() => first && onPlayTrack(first, availableTracks)}
                    aria-label={first ? `Tocar coleção offline ${collection.reference.name}` : `Coleção offline ${collection.reference.name} sem músicas disponíveis`}
                  >
                    <span className="offline-collection-card__icon"><CollectionIcon aria-hidden="true" /></span>
                    <span className="offline-collection-card__copy">
                      <strong>{collection.reference.name}</strong>
                      <small>{collection.downloadedCount}/{collection.totalCount} músicas · {collectionStatusLabel(collection)}</small>
                    </span>
                    {first && <Play aria-hidden="true" />}
                  </button>
                  <button
                    className="track-action"
                    type="button"
                    aria-label={`Remover coleção offline ${collection.reference.name}`}
                    onClick={() => {
                      if (!window.confirm(`Remover “${collection.reference.name}” das coleções offline? Músicas compartilhadas serão preservadas.`)) return;
                      onRemoveCollection(collection.reference.kind, collection.reference.sourceId);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {individualRecords.length > 0 ? (
        <section className="library-content">
          <div className="section-heading"><span>Downloads individuais</span><small>{individualRecords.length}</small></div>
          <div className="library-track-list">
            {individualRecords.map(record => {
              const track = record.track;
              const isCurrent = track.id === current?.id;
              const individualTracks = individualRecords.map(item => item.track);
              return (
                <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
                  <button
                    className="library-track__main"
                    type="button"
                    aria-current={isCurrent ? 'true' : undefined}
                    aria-label={`Tocar ${track.title}, ${track.artist || 'Artista desconhecido'}`}
                    onClick={() => onPlayTrack(track, individualTracks)}
                  >
                    <Artwork track={fallbackTrack(track)} />
                    <span className="library-track__text">
                      <strong>{track.title}</strong>
                      <small>{track.artist} · {formatOfflineBytes(record.size)}</small>
                    </span>
                    {isCurrent && playing ? <span className="playing-indicator" aria-hidden="true">▶</span> : <Play className="library-track__action" aria-hidden="true" />}
                  </button>
                  <button
                    className="track-action"
                    type="button"
                    aria-label={`Remover download individual de ${track.title}`}
                    onClick={() => {
                      if (window.confirm(`Remover o download individual de “${track.title}”? Se uma coleção também usar esta música, o arquivo será preservado.`)) onRemove(track.id);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : collections.length === 0 ? (
        <ResponsiveState
          variant="empty"
          title="Nenhum download offline"
          detail="Conecte ao Home Music e disponibilize músicas, playlists ou pastas para uso offline."
        >
          <button className="secondary-action" type="button" onClick={onExitOffline}>Tentar conectar</button>
        </ResponsiveState>
      ) : null}

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
    </>
  );
}
