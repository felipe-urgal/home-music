import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  LoaderCircle,
  Pause,
  Play,
  Trash2,
  X
} from 'lucide-react';
import type { TrackSort } from '../library-utils';
import { Artwork } from './Artwork';

type SortableColumn = 'title' | 'artist' | 'album';

const EMPTY_TRACK_IDS: ReadonlySet<string> = new Set();

type DesktopTrackTableProps = {
  tracks: Track[];
  context: Track[];
  current?: Track;
  playing: boolean;
  sort: TrackSort;
  onSort: (sort: TrackSort) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onRemove?: (trackId: string) => void;
  offlineSupported?: boolean;
  downloadedIds?: ReadonlySet<string>;
  individualDownloadedIds?: ReadonlySet<string>;
  collectionDownloadedIds?: ReadonlySet<string>;
  downloadingIds?: ReadonlySet<string>;
  onDownload?: (track: Track) => Promise<void>;
  onRemoveDownload?: (track: Track) => Promise<void>;
};

function formatDuration(value: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function sortDirection(sort: TrackSort, column: SortableColumn) {
  if (sort === `${column}-asc`) return 'ascending' as const;
  if (sort === `${column}-desc`) return 'descending' as const;
  return 'none' as const;
}

function nextSort(sort: TrackSort, column: SortableColumn): TrackSort {
  return sort === `${column}-asc` ? `${column}-desc` : `${column}-asc`;
}

function SortHeader({
  column,
  label,
  sort,
  onSort,
  className
}: {
  column: SortableColumn;
  label: string;
  sort: TrackSort;
  onSort: (sort: TrackSort) => void;
  className?: string;
}) {
  const direction = sortDirection(sort, column);
  const SortIcon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;

  return (
    <th className={className} scope="col" aria-sort={direction}>
      <button type="button" onClick={() => onSort(nextSort(sort, column))} aria-label={`Ordenar por ${label.toLocaleLowerCase('pt-BR')}`}>
        <span>{label}</span>
        <SortIcon aria-hidden="true" />
      </button>
    </th>
  );
}

function SelectAllCheckbox({ checked, mixed, onChange }: { checked: boolean; mixed: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label="Selecionar todas as faixas visíveis"
      onChange={onChange}
    />
  );
}

export function DesktopTrackTable({
  tracks,
  context,
  current,
  playing,
  sort,
  onSort,
  onPlayTrack,
  onRemove,
  offlineSupported = false,
  downloadedIds = EMPTY_TRACK_IDS,
  individualDownloadedIds = EMPTY_TRACK_IDS,
  collectionDownloadedIds = EMPTY_TRACK_IDS,
  downloadingIds = EMPTY_TRACK_IDS,
  onDownload,
  onRemoveDownload
}: DesktopTrackTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const visibleIds = useMemo(() => new Set(tracks.map(track => track.id)), [tracks]);
  const selectedTracks = useMemo(() => tracks.filter(track => selectedIds.has(track.id)), [selectedIds, tracks]);
  const downloadableSelectedTracks = useMemo(() => selectedTracks.filter(track => (
    !downloadedIds.has(track.id) && !downloadingIds.has(track.id)
  )), [downloadedIds, downloadingIds, selectedTracks]);
  const selectedDownloadingCount = useMemo(() => selectedTracks.reduce((count, track) => (
    count + (downloadingIds.has(track.id) ? 1 : 0)
  ), 0), [downloadingIds, selectedTracks]);
  const allSelected = tracks.length > 0 && selectedTracks.length === tracks.length;
  const mixedSelection = selectedTracks.length > 0 && !allSelected;
  const offlineActionsAvailable = offlineSupported && Boolean(onDownload) && Boolean(onRemoveDownload);
  const hasActions = Boolean(onRemove) || offlineActionsAvailable;

  useEffect(() => {
    setSelectedIds(currentSelection => {
      const next = new Set([...currentSelection].filter(id => visibleIds.has(id)));
      if (next.size === currentSelection.size && [...next].every(id => currentSelection.has(id))) return currentSelection;
      return next;
    });
  }, [visibleIds]);

  function toggleTrackSelection(trackId: string) {
    setSelectedIds(currentSelection => {
      const next = new Set(currentSelection);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(tracks.map(track => track.id)));
  }

  function playSelection() {
    const first = selectedTracks[0];
    if (first) onPlayTrack(first, selectedTracks);
  }

  function downloadSelection() {
    if (!onDownload || downloadableSelectedTracks.length === 0) return;
    void Promise.allSettled(downloadableSelectedTracks.map(track => onDownload(track)));
  }

  function runOfflineAction(track: Track) {
    if (!offlineActionsAvailable || !onDownload || !onRemoveDownload) return;
    const downloaded = downloadedIds.has(track.id);
    const hasIndividual = individualDownloadedIds.has(track.id);
    if (downloaded && !hasIndividual && collectionDownloadedIds.has(track.id)) return;
    const operation = downloaded ? onRemoveDownload(track) : onDownload(track);
    void operation.catch(() => undefined);
  }

  function bulkDownloadLabel() {
    if (downloadableSelectedTracks.length > 0) return `Baixar ${downloadableSelectedTracks.length}`;
    if (selectedDownloadingCount > 0) return 'Baixando…';
    return 'Disponível offline';
  }

  return (
    <div className="desktop-library-table-shell" data-testid="desktop-library-table">
      <div className="desktop-bulk-toolbar" data-testid="desktop-bulk-toolbar" aria-live="polite">
        <label className="desktop-bulk-toolbar__selection">
          <SelectAllCheckbox checked={allSelected} mixed={mixedSelection} onChange={toggleSelectAll} />
          <span>{selectedTracks.length > 0 ? `${selectedTracks.length} selecionada${selectedTracks.length === 1 ? '' : 's'}` : 'Selecionar faixas'}</span>
        </label>
        {selectedTracks.length > 0 && (
          <div className="desktop-bulk-toolbar__actions">
            <button type="button" onClick={playSelection}><Play />Tocar seleção</button>
            {offlineActionsAvailable && (
              <button
                type="button"
                disabled={downloadableSelectedTracks.length === 0}
                aria-label={downloadableSelectedTracks.length > 0
                  ? `Baixar ${downloadableSelectedTracks.length} ${downloadableSelectedTracks.length === 1 ? 'faixa selecionada' : 'faixas selecionadas'} para uso offline`
                  : selectedDownloadingCount > 0
                    ? 'Downloads selecionados em andamento'
                    : 'Todas as faixas selecionadas já estão disponíveis offline'}
                onClick={downloadSelection}
              >
                {selectedDownloadingCount > 0 && downloadableSelectedTracks.length === 0
                  ? <LoaderCircle className="desktop-offline-spinner" />
                  : downloadableSelectedTracks.length === 0
                    ? <CheckCircle2 />
                    : <Download />}
                {bulkDownloadLabel()}
              </button>
            )}
            <button type="button" aria-label="Limpar seleção" onClick={() => setSelectedIds(new Set())}><X />Limpar</button>
          </div>
        )}
      </div>

      <table className="desktop-library-table">
        <thead>
          <tr>
            <th className="desktop-library-table__select" scope="col">
              <SelectAllCheckbox checked={allSelected} mixed={mixedSelection} onChange={toggleSelectAll} />
            </th>
            <SortHeader column="title" label="Título" sort={sort} onSort={onSort} />
            <SortHeader column="artist" label="Artista" sort={sort} onSort={onSort} />
            <SortHeader className="desktop-library-table__album" column="album" label="Álbum" sort={sort} onSort={onSort} />
            <th className="desktop-library-table__folder" scope="col">Pasta</th>
            <th className="desktop-library-table__format" scope="col">Formato</th>
            <th className="desktop-library-table__duration" scope="col">Duração</th>
            {hasActions && <th className="desktop-library-table__actions" scope="col">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {tracks.map(track => {
            const isCurrent = track.id === current?.id;
            const selected = selectedIds.has(track.id);
            const downloaded = downloadedIds.has(track.id);
            const downloading = downloadingIds.has(track.id);
            const hasIndividual = individualDownloadedIds.has(track.id);
            const viaCollection = collectionDownloadedIds.has(track.id);
            const protectedByCollection = downloaded && viaCollection && !hasIndividual;
            const trackArtist = track.albumArtist || track.artist || 'Artista desconhecido';
            const trackAlbum = track.album || 'Álbum desconhecido';
            const accessibleTrackLabel = `Tocar ${track.title}, ${trackArtist}, ${trackAlbum}${isCurrent && playing ? ' — reproduzindo agora' : ''}`;
            const offlineLabel = downloading
              ? `Baixando ${track.title} para uso offline`
              : protectedByCollection
                ? `${track.title} está disponível offline por uma coleção`
                : downloaded
                  ? viaCollection
                    ? `Remover download individual de ${track.title}; a coleção manterá a música offline`
                    : `Remover download offline de ${track.title}`
                  : `Baixar ${track.title} para uso offline`;

            return (
              <tr className={`${isCurrent ? 'is-current' : ''} ${selected ? 'is-selected' : ''}`.trim()} key={track.id}>
                <td className="desktop-library-table__select">
                  <input
                    type="checkbox"
                    checked={selected}
                    aria-label={`Selecionar ${track.title}`}
                    onChange={() => toggleTrackSelection(track.id)}
                  />
                </td>
                <td>
                  <button
                    className="desktop-library-table__track"
                    type="button"
                    onClick={() => onPlayTrack(track, context)}
                    aria-current={isCurrent ? 'true' : undefined}
                    aria-label={accessibleTrackLabel}
                  >
                    <Artwork track={track} />
                    <span className="desktop-library-table__track-copy">
                      <strong>{track.title}</strong>
                      <small>{trackArtist}</small>
                    </span>
                    <span className="desktop-library-table__play-state" aria-hidden="true">
                      {isCurrent && playing ? <Pause /> : <Play />}
                    </span>
                  </button>
                </td>
                <td className="desktop-library-table__text-cell">{track.artist || 'Artista desconhecido'}</td>
                <td className="desktop-library-table__text-cell desktop-library-table__album">{trackAlbum}</td>
                <td className="desktop-library-table__text-cell desktop-library-table__folder" title={track.folderPath || track.folder}>{track.folder || '—'}</td>
                <td className="desktop-library-table__format">{track.format || '—'}</td>
                <td className="desktop-library-table__duration">{formatDuration(track.duration)}</td>
                {hasActions && (
                  <td className="desktop-library-table__actions">
                    <div>
                      {offlineActionsAvailable && (
                        <button
                          className={`desktop-library-table__action desktop-library-table__action--offline ${downloaded ? 'is-downloaded' : ''} ${downloading ? 'is-loading' : ''}`.trim()}
                          type="button"
                          disabled={downloading || protectedByCollection}
                          aria-label={offlineLabel}
                          aria-pressed={downloaded}
                          title={protectedByCollection ? 'Gerencie esta música pela coleção offline correspondente.' : undefined}
                          onClick={() => runOfflineAction(track)}
                        >
                          {downloading
                            ? <LoaderCircle className="desktop-offline-spinner" />
                            : downloaded
                              ? <CheckCircle2 />
                              : <Download />}
                        </button>
                      )}
                      {onRemove && (
                        <button
                          className="desktop-library-table__action"
                          type="button"
                          aria-label={`Remover ${track.title} da playlist`}
                          onClick={() => onRemove(track.id)}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
