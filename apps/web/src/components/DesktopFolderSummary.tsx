import type { ReactNode } from 'react';
import { Clock, Download, Image, Pause, Play, Music2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { m } from 'motion/react';
import { Artwork } from './Artwork';
import { LibraryMotion, cardEntrance } from './library-motion';

type DesktopFolderSummaryProps = {
  name: string;
  tracks: Track[];
  downloadedIds: ReadonlySet<string>;
  offlineControl?: ReactNode;
  playing: boolean;
  onTogglePlayback: () => void;
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

export function DesktopFolderSummary({
  name,
  tracks,
  downloadedIds,
  offlineControl,
  playing,
  onTogglePlayback
}: DesktopFolderSummaryProps) {
  const artworkTrack = tracks.find(track => track.hasCover) ?? tracks[0];
  const offlineCount = tracks.reduce((count, track) => count + (downloadedIds.has(track.id) ? 1 : 0), 0);
  const withCoverCount = tracks.reduce((count, track) => count + (track.hasCover ? 1 : 0), 0);

  return (
    <LibraryMotion>
    <m.aside className="desktop-folder-summary" data-testid="desktop-folder-summary" aria-label={`Resumo da pasta ${name}`} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}>
      <m.button
        className="desktop-folder-summary__cover"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        type="button"
        aria-label={playing ? 'Pausar pasta' : 'Tocar pasta'}
        disabled={!tracks.length}
        onClick={onTogglePlayback}
      >
        <Artwork track={artworkTrack} />
        <span className="desktop-folder-summary__cover-play" aria-hidden="true">
          {playing ? <Pause /> : <Play />}
        </span>
      </m.button>

      <div className="desktop-folder-summary__identity">
        <span className="desktop-folder-summary__identity-icon" aria-hidden="true"><Music2 /></span>
        <span>
          <strong>{name}</strong>
          <small>{tracks.length} músicas</small>
        </span>
      </div>

      <dl className="desktop-folder-summary__stats">
        <m.div {...cardEntrance(1)}>
          <dt><Clock aria-hidden="true" /><span>Duração total</span></dt>
          <dd>{formatTotalDuration(tracks)}</dd>
        </m.div>
        <m.div {...cardEntrance(2)}>
          <dt><Download aria-hidden="true" /><span>Disponível offline</span></dt>
          <dd>{offlineCount} de {tracks.length}</dd>
        </m.div>
        <m.div {...cardEntrance(3)}>
          <dt><Music2 aria-hidden="true" /><span>Formato predominante</span></dt>
          <dd>{predominantFormat(tracks)}</dd>
        </m.div>
        <m.div {...cardEntrance(4)}>
          <dt><Image aria-hidden="true" /><span>Com capa</span></dt>
          <dd>{withCoverCount} de {tracks.length}</dd>
        </m.div>
      </dl>

      {offlineControl && <div className="desktop-folder-summary__offline-action">{offlineControl}</div>}

      <div className="desktop-folder-summary__quote" aria-hidden="true">
        <span>Música boa</span>
        <strong>torna tudo</strong>
        <strong>mais leve.</strong>
      </div>
    </m.aside>
    </LibraryMotion>
  );
}
