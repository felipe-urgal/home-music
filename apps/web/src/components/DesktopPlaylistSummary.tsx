import type { ReactNode } from 'react';
import { Clock, Download, Image, ListMusic } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { Artwork } from './Artwork';

type DesktopPlaylistSummaryProps = {
  name: string;
  tracks: Track[];
  downloadedIds: ReadonlySet<string>;
  offlineControl?: ReactNode;
};

function formatTotalDuration(tracks: Track[]) {
  const totalSeconds = tracks.reduce((total, track) => total + (track.duration ?? 0), 0);
  if (totalSeconds <= 0) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function predominantFormat(tracks: Track[]) {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const format = track.format?.trim();
    if (!format) continue;
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]?.toUpperCase() ?? '—';
}

export function DesktopPlaylistSummary({
  name,
  tracks,
  downloadedIds,
  offlineControl
}: DesktopPlaylistSummaryProps) {
  const artworkTrack = tracks.find(track => track.hasCover) ?? tracks[0];
  const offlineCount = tracks.reduce((count, track) => count + (downloadedIds.has(track.id) ? 1 : 0), 0);
  const withCoverCount = tracks.reduce((count, track) => count + (track.hasCover ? 1 : 0), 0);

  return (
    <aside
      className="desktop-folder-summary desktop-playlist-summary"
      data-testid="desktop-playlist-summary"
      aria-label={`Resumo da playlist ${name}`}
    >
      <div className="desktop-folder-summary__cover">
        <Artwork track={artworkTrack} />
        <span className="desktop-folder-summary__cover-title">{name}</span>
      </div>

      <div className="desktop-folder-summary__identity">
        <span className="desktop-folder-summary__identity-icon" aria-hidden="true"><ListMusic /></span>
        <span>
          <strong>{name}</strong>
          <small>{tracks.length} músicas</small>
        </span>
      </div>

      <dl className="desktop-folder-summary__stats">
        <div>
          <dt><Clock aria-hidden="true" /><span>Duração total</span></dt>
          <dd>{formatTotalDuration(tracks)}</dd>
        </div>
        <div>
          <dt><Download aria-hidden="true" /><span>Disponível offline</span></dt>
          <dd>{offlineCount} de {tracks.length}</dd>
        </div>
        <div>
          <dt><ListMusic aria-hidden="true" /><span>Formato predominante</span></dt>
          <dd>{predominantFormat(tracks)}</dd>
        </div>
        <div>
          <dt><Image aria-hidden="true" /><span>Com capa</span></dt>
          <dd>{withCoverCount} de {tracks.length}</dd>
        </div>
      </dl>

      {offlineControl && <div className="desktop-folder-summary__offline-action">{offlineControl}</div>}

      <div className="desktop-folder-summary__quote" aria-hidden="true">
        <span>Cada playlist</span>
        <strong>guarda um</strong>
        <strong>momento.</strong>
      </div>
    </aside>
  );
}
