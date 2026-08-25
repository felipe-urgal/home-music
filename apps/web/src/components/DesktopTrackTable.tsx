import type { Track } from '@home-music/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, Heart, Pause, Play, Trash2 } from 'lucide-react';
import type { TrackSort } from '../library-utils';
import { Artwork } from './Artwork';

type SortableColumn = 'title' | 'artist' | 'album';

type DesktopTrackTableProps = {
  tracks: Track[];
  context: Track[];
  current?: Track;
  playing: boolean;
  favorites: Set<string>;
  sort: TrackSort;
  onSort: (sort: TrackSort) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onToggleFavorite: (trackId: string) => void;
  onRemove?: (trackId: string) => void;
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

export function DesktopTrackTable({
  tracks,
  context,
  current,
  playing,
  favorites,
  sort,
  onSort,
  onPlayTrack,
  onToggleFavorite,
  onRemove
}: DesktopTrackTableProps) {
  return (
    <div className="desktop-library-table-shell" data-testid="desktop-library-table">
      <table className="desktop-library-table">
        <thead>
          <tr>
            <SortHeader column="title" label="Título" sort={sort} onSort={onSort} />
            <SortHeader column="artist" label="Artista" sort={sort} onSort={onSort} />
            <SortHeader className="desktop-library-table__album" column="album" label="Álbum" sort={sort} onSort={onSort} />
            <th className="desktop-library-table__folder" scope="col">Pasta</th>
            <th className="desktop-library-table__format" scope="col">Formato</th>
            <th className="desktop-library-table__duration" scope="col">Duração</th>
            <th className="desktop-library-table__actions" scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map(track => {
            const favorite = favorites.has(track.id);
            const isCurrent = track.id === current?.id;
            return (
              <tr className={isCurrent ? 'is-current' : ''} key={track.id}>
                <td>
                  <button
                    className="desktop-library-table__track"
                    type="button"
                    onClick={() => onPlayTrack(track, context)}
                    aria-label={`Tocar ${track.title}`}
                  >
                    <Artwork track={track} />
                    <span className="desktop-library-table__track-copy">
                      <strong>{track.title}</strong>
                      <small>{track.albumArtist || track.artist || 'Artista desconhecido'}</small>
                    </span>
                    <span className="desktop-library-table__play-state" aria-hidden="true">
                      {isCurrent && playing ? <Pause /> : <Play />}
                    </span>
                  </button>
                </td>
                <td className="desktop-library-table__text-cell">{track.artist || 'Artista desconhecido'}</td>
                <td className="desktop-library-table__text-cell desktop-library-table__album">{track.album || 'Álbum desconhecido'}</td>
                <td className="desktop-library-table__text-cell desktop-library-table__folder" title={track.folderPath || track.folder}>{track.folder || '—'}</td>
                <td className="desktop-library-table__format">{track.format || '—'}</td>
                <td className="desktop-library-table__duration">{formatDuration(track.duration)}</td>
                <td className="desktop-library-table__actions">
                  <div>
                    <button
                      className={`desktop-library-table__action ${favorite ? 'is-active' : ''}`}
                      type="button"
                      aria-label={favorite ? `Remover ${track.title} dos favoritos` : `Favoritar ${track.title}`}
                      onClick={() => onToggleFavorite(track.id)}
                    >
                      <Heart fill={favorite ? 'currentColor' : 'none'} />
                    </button>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
