import { Play, Trash2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import type { TrackSort } from '../library-utils';
import { useDesktopLayout } from '../useDesktopLayout';
import { Artwork } from './Artwork';
import { DesktopTrackTable } from './DesktopTrackTable';

export type LibraryTrackOfflineProps = {
  offlineSupported: boolean;
  downloadedIds: ReadonlySet<string>;
  downloadingIds: ReadonlySet<string>;
  onDownload: (track: Track) => Promise<void>;
  onRemoveDownload: (track: Track) => Promise<void>;
};

type LibraryTrackRowsProps = LibraryTrackOfflineProps & {
  tracks: Track[];
  context: Track[];
  current?: Track;
  playing: boolean;
  sort: TrackSort;
  onSort: (sort: TrackSort) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onRemove?: (trackId: string) => void;
};

export function LibraryTrackRows({
  tracks,
  context,
  current,
  playing,
  sort,
  onSort,
  onPlayTrack,
  onRemove,
  offlineSupported,
  downloadedIds,
  downloadingIds,
  onDownload,
  onRemoveDownload
}: LibraryTrackRowsProps) {
  const isDesktop = useDesktopLayout();

  if (isDesktop) {
    return (
      <DesktopTrackTable
        tracks={tracks}
        context={context}
        current={current}
        playing={playing}
        sort={sort}
        onSort={onSort}
        onPlayTrack={onPlayTrack}
        onRemove={onRemove}
        offlineSupported={offlineSupported}
        downloadedIds={downloadedIds}
        downloadingIds={downloadingIds}
        onDownload={onDownload}
        onRemoveDownload={onRemoveDownload}
      />
    );
  }

  return (
    <div className="library-track-list">
      {tracks.map(track => {
        const isCurrent = track.id === current?.id;
        return (
          <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
            <button className="library-track__main" onClick={() => onPlayTrack(track, context)}>
              <Artwork track={track} />
              <span className="library-track__text">
                <strong>{track.title}</strong>
                <small>{track.artist} · {track.album}</small>
              </span>
              {isCurrent && playing ? <span className="playing-indicator">▶</span> : <Play className="library-track__action" />}
            </button>
            {onRemove && (
              <button className="track-action" aria-label="Remover da playlist" onClick={() => onRemove(track.id)}><Trash2 /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}
