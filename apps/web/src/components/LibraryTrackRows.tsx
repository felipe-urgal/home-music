import { CheckCircle2, Download, LoaderCircle, Pause, Play, Trash2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import type { TrackSort } from '../library-utils';
import { useDesktopLayout } from '../useDesktopLayout';
import { Artwork } from './Artwork';
import { DesktopTrackTable } from './DesktopTrackTable';

export type LibraryTrackOfflineProps = {
  offlineSupported: boolean;
  downloadedIds: ReadonlySet<string>;
  individualDownloadedIds: ReadonlySet<string>;
  collectionDownloadedIds: ReadonlySet<string>;
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
  onTogglePlay: () => void;
  onRemove?: (trackId: string) => void;
  desktopVariant?: 'table' | 'grid';
};

export function LibraryTrackRows({
  tracks,
  context,
  current,
  playing,
  sort,
  onSort,
  onPlayTrack,
  onTogglePlay,
  onRemove,
  desktopVariant = 'table',
  offlineSupported,
  downloadedIds,
  individualDownloadedIds,
  collectionDownloadedIds,
  downloadingIds,
  onDownload,
  onRemoveDownload
}: LibraryTrackRowsProps) {
  const isDesktop = useDesktopLayout();

  if (isDesktop && desktopVariant === 'grid') {
    const offlineActionsAvailable = offlineSupported && Boolean(onDownload) && Boolean(onRemoveDownload);

    return (
      <div className="desktop-track-grid" data-testid="desktop-track-grid">
        {tracks.map(track => {
          const isCurrent = track.id === current?.id;
          const downloading = downloadingIds.has(track.id);
          const downloaded = downloadedIds.has(track.id);
          const hasIndividual = individualDownloadedIds.has(track.id);
          const trackArtist = track.albumArtist || track.artist || 'Artista desconhecido';

          return (
            <article className={`desktop-track-card ${isCurrent ? 'is-current' : ''}`} key={track.id}>
              <button
                className="desktop-track-card__main"
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`${isCurrent && playing ? 'Pausar' : 'Tocar'} ${track.title}, ${trackArtist}`}
                onClick={() => {
                  if (isCurrent) onTogglePlay();
                  else onPlayTrack(track, context);
                }}
              >
                <span className="desktop-track-card__artwork">
                  <Artwork track={track} />
                  <span className="desktop-track-card__play" aria-hidden="true">
                    {isCurrent && playing ? <Pause /> : <Play />}
                  </span>
                </span>
                <span className="desktop-track-card__copy">
                  <strong>{track.title}</strong>
                  <span>{trackArtist}</span>
                  <small>{track.album || 'Álbum desconhecido'}</small>
                </span>
              </button>

              {(offlineActionsAvailable || onRemove) && (
                <div className="desktop-track-card__actions">
                  {offlineActionsAvailable && onDownload && onRemoveDownload && (
                    <button
                      type="button"
                      disabled={downloading}
                      aria-label={downloading
                        ? `Baixando ${track.title}`
                        : downloaded && hasIndividual
                          ? `Remover download de ${track.title}`
                          : `Salvar ${track.title} offline`}
                      title={downloading
                        ? 'Baixando…'
                        : downloaded && hasIndividual
                          ? 'Remover download'
                          : 'Salvar offline'}
                      onClick={() => {
                        const operation = downloaded && hasIndividual
                          ? onRemoveDownload(track)
                          : onDownload(track);
                        void operation.catch(() => undefined);
                      }}
                    >
                      {downloading
                        ? <LoaderCircle className="desktop-offline-spinner" aria-hidden="true" />
                        : downloaded && hasIndividual
                          ? <CheckCircle2 aria-hidden="true" />
                          : <Download aria-hidden="true" />}
                    </button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      aria-label={`Remover ${track.title} da playlist`}
                      title="Remover da playlist"
                      onClick={() => onRemove(track.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    );
  }

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
        individualDownloadedIds={individualDownloadedIds}
        collectionDownloadedIds={collectionDownloadedIds}
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
        const accessibleTrackLabel = `Tocar ${track.title}, ${track.artist || 'Artista desconhecido'}, ${track.album || 'Álbum desconhecido'}${isCurrent && playing ? ' — reproduzindo agora' : ''}`;
        return (
          <div className={`library-track ${isCurrent ? 'is-current' : ''}`} key={track.id}>
            <button
              className="library-track__main"
              type="button"
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={accessibleTrackLabel}
              onClick={() => onPlayTrack(track, context)}
            >
              <Artwork track={track} />
              <span className="library-track__text">
                <strong>{track.title}</strong>
                <small>{track.artist} · {track.album}</small>
              </span>
              {isCurrent && playing
                ? <span className="playing-indicator" aria-hidden="true">▶</span>
                : <Play className="library-track__action" aria-hidden="true" />}
            </button>
            {onRemove && (
              <button className="track-action" type="button" aria-label={`Remover ${track.title} da playlist`} onClick={() => onRemove(track.id)}><Trash2 aria-hidden="true" /></button>
            )}
          </div>
        );
      })}
    </div>
  );
}
