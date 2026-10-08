import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Folder, ListMusic, LoaderCircle, Play, Trash2, Wifi } from 'lucide-react';
import type { Track } from '@home-music/shared';
import type { OfflineCollectionKind } from '../offline-collection-references';
import {
  formatOfflineBytes,
  type OfflineCollectionSummary,
  type OfflineDownloadRecord
} from '../offline-downloads';
import { LIBRARY_PAGE_SIZE } from '../useLibraryNavigation';
import { ActionDialog } from './ActionDialog';
import { Artwork } from './Artwork';
import { MiniPlayer } from './MiniPlayer';
import { ResponsiveState } from './ResponsiveState';

type TvLanState = 'disconnected' | 'connecting' | 'connected' | 'sending';

type OfflineLibraryScreenProps = {
  records: OfflineDownloadRecord[];
  collections: OfflineCollectionSummary[];
  individualTrackIds: ReadonlySet<string>;
  current?: Track;
  playing: boolean;
  hasNext: boolean;
  totalBytes: number;
  tvState: TvLanState;
  tvMessage: string | null;
  onTvConnect: () => void;
  onTvDisconnect: () => void;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onRemove: (trackId: string) => Promise<void>;
  onRemoveCollection: (kind: OfflineCollectionKind, sourceId: string) => Promise<void>;
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

function availableCollectionRecords(
  collection: OfflineCollectionSummary,
  recordsById: Map<string, OfflineDownloadRecord>
) {
  return collection.reference.trackIds
    .map(trackId => recordsById.get(trackId))
    .filter((record): record is OfflineDownloadRecord => Boolean(record));
}

export function OfflineLibraryScreen({
  records,
  collections,
  individualTrackIds,
  current,
  playing,
  hasNext,
  totalBytes,
  tvState,
  tvMessage,
  onTvConnect,
  onTvDisconnect,
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onPlayTrack,
  onRemove,
  onRemoveCollection,
  onExitOffline
}: OfflineLibraryScreenProps) {
  const [visibleIndividualCount, setVisibleIndividualCount] = useState(LIBRARY_PAGE_SIZE);
  const [selectedCollectionKey, setSelectedCollectionKey] = useState<string | null>(null);
  const [removal, setRemoval] = useState<{ kind: 'track' | 'collection'; key: string; name: string; collectionKind?: OfflineCollectionKind; sourceId?: string } | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const removalRef = useRef(removal);
  removalRef.current = removal;

  useEffect(() => {
    if (!removal || busyRef.current.has(removal.key)) return;
    const stillExists = removal.kind === 'track'
      ? individualTrackIds.has(removal.key.slice('track:'.length))
      : collections.some(collection => collection.key === removal.key.slice('collection:'.length));
    if (!stillExists) {
      setRemoval(null);
      setRemovalError(null);
    }
  }, [collections, individualTrackIds, removal]);

  const confirmRemoval = async () => {
    const target = removalRef.current;
    if (!target || busyRef.current.has(target.key)) return;
    busyRef.current.add(target.key);
    setBusyKeys(new Set(busyRef.current));
    setRemovalError(null);
    try {
      if (target.kind === 'track') await onRemove(target.key.slice('track:'.length));
      else await onRemoveCollection(target.collectionKind!, target.sourceId!);
      if (removalRef.current?.key === target.key) setRemoval(null);
    } catch (error) {
      if (removalRef.current?.key === target.key) {
        setRemovalError(error instanceof Error && error.name === 'QuotaExceededError'
          ? 'O armazenamento está cheio. Libere espaço e tente novamente.'
          : 'Não foi possível remover este download. Verifique o armazenamento do navegador e tente novamente.');
      }
    } finally {
      busyRef.current.delete(target.key);
      setBusyKeys(new Set(busyRef.current));
    }
  };
  const recordsById = new Map(records.map(record => [record.track.id, record]));
  const individualRecords = records.filter(record => individualTrackIds.has(record.track.id));
  const individualTracks = individualRecords.map(record => record.track);
  const visibleIndividualRecords = individualRecords.slice(0, visibleIndividualCount);
  const remainingIndividualCount = Math.max(0, individualRecords.length - visibleIndividualRecords.length);
  const selectedCollection = selectedCollectionKey
    ? collections.find(collection => collection.key === selectedCollectionKey) ?? null
    : null;
  const selectedCollectionRecords = selectedCollection
    ? availableCollectionRecords(selectedCollection, recordsById)
    : [];
  const selectedCollectionTracks = selectedCollectionRecords.map(record => record.track);
  const selectedCollectionFirst = selectedCollectionTracks[0];
  const tvConnected = tvState === 'connected' || tvState === 'sending';
  const tvBusy = tvState === 'connecting' || tvState === 'sending';
  const playVerb = tvConnected ? 'Enviar para a TV' : 'Tocar';

  return (
    <>
      <header className="offline-header">
        <span className="offline-header__icon"><Download aria-hidden="true" /></span>
        <div className="offline-header__title">
          <strong>Downloads offline</strong>
          <small>{records.length} músicas · {formatOfflineBytes(totalBytes)} armazenados</small>
        </div>
        <button className="icon-button" type="button" aria-label="Tentar conectar ao servidor" onClick={onExitOffline}><Wifi aria-hidden="true" /></button>
      </header>

      <div className="offline-banner" role="status">
        <Download aria-hidden="true" />
        <span>{tvMessage ?? 'Modo offline. O espaço utilizado considera cada arquivo apenas uma vez, mesmo quando está em várias coleções.'}</span>
        <button
          className="secondary-action"
          type="button"
          disabled={tvBusy}
          onClick={tvConnected ? onTvDisconnect : onTvConnect}
        >
          {tvState === 'connecting'
            ? 'Conectando…'
            : tvState === 'sending'
              ? 'Enviando…'
              : tvConnected
                ? 'Desconectar TV'
                : 'Conectar à TV'}
        </button>
      </div>

      {selectedCollection ? (
        <section className="library-content offline-collection-detail">
          <div className="offline-collection-detail__header">
            <button
              className="icon-button"
              type="button"
              aria-label="Voltar às coleções offline"
              onClick={() => setSelectedCollectionKey(null)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <div className="offline-collection-detail__copy">
              <strong>{selectedCollection.reference.name}</strong>
              <small>
                {selectedCollectionTracks.length} disponíveis · {Math.max(0, selectedCollection.totalCount - selectedCollectionTracks.length)} pendentes · {collectionStatusLabel(selectedCollection)}
              </small>
            </div>
            <button
              className="secondary-action offline-collection-detail__play-all"
              type="button"
              disabled={!selectedCollectionFirst || tvBusy}
              aria-label={`${playVerb} todas as músicas de ${selectedCollection.reference.name}`}
              onClick={() => selectedCollectionFirst && onPlayTrack(selectedCollectionFirst, selectedCollectionTracks)}
            >
              <Play aria-hidden="true" />
              {tvConnected ? 'Enviar tudo' : 'Tocar tudo'}
            </button>
          </div>

          {selectedCollectionRecords.length > 0 ? (
            <div className="library-track-list">
              {selectedCollectionRecords.map(record => {
                const track = record.track;
                const isCurrent = track.id === current?.id;
                return (
                  <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
                    <button
                      className="library-track__main"
                      type="button"
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-label={`${playVerb} ${track.title}, ${track.artist || 'Artista desconhecido'}`}
                      onClick={() => onPlayTrack(track, selectedCollectionTracks)}
                    >
                      <Artwork track={fallbackTrack(track)} />
                      <span className="library-track__text">
                        <strong>{track.title}</strong>
                        <small>{track.artist} · {formatOfflineBytes(record.size)}</small>
                      </span>
                      {isCurrent && playing && !tvConnected
                        ? <span className="playing-indicator" aria-hidden="true">▶</span>
                        : <Play className="library-track__action" aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <ResponsiveState
              variant="empty"
              title="Nenhuma música disponível"
              detail="Esta coleção não tem músicas baixadas neste dispositivo."
            />
          )}
        </section>
      ) : (
        <>
          {collections.length > 0 && (
            <section className="library-content offline-collections-section">
              <div className="section-heading"><span>Coleções offline</span><small>{collections.length}</small></div>
              <div className="offline-collection-list">
                {collections.map(collection => {
                  const availableRecords = availableCollectionRecords(collection, recordsById);
                  const availableTracks = availableRecords.map(record => record.track);
                  const first = availableTracks[0];
                  const CollectionIcon = collection.reference.kind === 'playlist' ? ListMusic : Folder;

                  return (
                    <article className="offline-collection-card" key={collection.key}>
                      <button
                        className="offline-collection-card__main"
                        type="button"
                        onClick={() => setSelectedCollectionKey(collection.key)}
                        aria-label={`Abrir coleção offline ${collection.reference.name}`}
                      >
                        <span className="offline-collection-card__icon"><CollectionIcon aria-hidden="true" /></span>
                        <span className="offline-collection-card__copy">
                          <strong>{collection.reference.name}</strong>
                          <small>{collection.downloadedCount} disponíveis · {Math.max(0, collection.totalCount - collection.downloadedCount)} pendentes · {collectionStatusLabel(collection)}</small>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </button>
                      <button
                        className="track-action"
                        type="button"
                        disabled={!first || tvBusy}
                        aria-label={`${playVerb} coleção offline ${collection.reference.name}`}
                        onClick={() => first && onPlayTrack(first, availableTracks)}
                      >
                        <Play aria-hidden="true" />
                      </button>
                      <button
                        className="track-action"
                        type="button"
                        aria-label={`Remover coleção offline ${collection.reference.name}`}
                        disabled={busyKeys.has(`collection:${collection.key}`)}
                        onClick={() => {
                          setRemovalError(null);
                          setRemoval({ kind: 'collection', key: `collection:${collection.key}`, name: collection.reference.name, collectionKind: collection.reference.kind, sourceId: collection.reference.sourceId });
                        }}
                      >
                        {busyKeys.has(`collection:${collection.key}`) ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
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
                {visibleIndividualRecords.map(record => {
                  const track = record.track;
                  const isCurrent = track.id === current?.id;
                  return (
                    <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
                      <button
                        className="library-track__main"
                        type="button"
                        aria-current={isCurrent ? 'true' : undefined}
                        aria-label={`${playVerb} ${track.title}, ${track.artist || 'Artista desconhecido'}`}
                        onClick={() => onPlayTrack(track, individualTracks)}
                      >
                        <Artwork track={fallbackTrack(track)} />
                        <span className="library-track__text">
                          <strong>{track.title}</strong>
                          <small>{track.artist} · {formatOfflineBytes(record.size)}</small>
                        </span>
                        {isCurrent && playing && !tvConnected ? <span className="playing-indicator" aria-hidden="true">▶</span> : <Play className="library-track__action" aria-hidden="true" />}
                      </button>
                      <button
                        className="track-action"
                        type="button"
                        aria-label={`Remover download individual de ${track.title}`}
                        disabled={busyKeys.has(`track:${track.id}`)}
                        onClick={() => {
                          setRemovalError(null);
                          setRemoval({ kind: 'track', key: `track:${track.id}`, name: track.title });
                        }}
                      >
                        {busyKeys.has(`track:${track.id}`) ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                      </button>
                    </div>
                  );
                })}
              </div>
              {remainingIndividualCount > 0 && (
                <button
                  className="load-more"
                  type="button"
                  onClick={() => setVisibleIndividualCount(count => count + LIBRARY_PAGE_SIZE)}
                >
                  Mostrar mais {Math.min(LIBRARY_PAGE_SIZE, remainingIndividualCount)} músicas
                </button>
              )}
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
        </>
      )}

      <ActionDialog
        open={Boolean(removal)}
        title={removal?.kind === 'collection' ? 'Remover coleção offline?' : 'Remover download individual?'}
        description={`Remover “${removal?.name ?? ''}” dos downloads offline? O arquivo será mantido se ainda for utilizado por outra coleção ou download.`}
        confirmLabel="Remover"
        danger
        busy={Boolean(removal && busyKeys.has(removal.key))}
        error={removalError}
        onConfirm={() => { void confirmRemoval(); }}
        onClose={() => { setRemoval(null); setRemovalError(null); }}
      />
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
