import type { Track } from '@home-music/shared';
import type { CrossfadeVisualState } from './crossfade-visual';

export type TvCrossfadePresentation = {
  incomingTrack: Track | null;
  progress: number | null;
  outgoingOpacity: number;
  incomingOpacity: number;
};

export function resolveTvCrossfadePresentation(
  current: Track | undefined,
  crossfade: CrossfadeVisualState | null
): TvCrossfadePresentation {
  if (!current || !crossfade || crossfade.originTrackId !== current.id) {
    return {
      incomingTrack: null,
      progress: null,
      outgoingOpacity: 1,
      incomingOpacity: 0
    };
  }

  const duration = Math.max(0.1, crossfade.durationSeconds);
  const progress = Math.max(0, Math.min(1, crossfade.elapsedSeconds / duration));

  return {
    incomingTrack: crossfade.incomingTrack,
    progress,
    outgoingOpacity: 1 - progress,
    incomingOpacity: progress
  };
}

function artworkUrl(track: Track) {
  if (!track.hasCover) return null;
  const version = track.coverVersion ? `?v=${encodeURIComponent(track.coverVersion)}` : '';
  return `/api/tracks/${encodeURIComponent(track.id)}/cover${version}`;
}

function cssString(value: string) {
  return JSON.stringify(value);
}

export function syncTvCrossfadeCss(root: HTMLElement | null, crossfade: CrossfadeVisualState | null) {
  if (!root) return;

  if (!crossfade) {
    root.removeAttribute('data-tv-crossfade');
    root.style.removeProperty('--tv-crossfade-outgoing-opacity');
    root.style.removeProperty('--tv-crossfade-incoming-opacity');
    root.style.removeProperty('--tv-crossfade-incoming-title');
    root.style.removeProperty('--tv-crossfade-incoming-artist');
    root.style.removeProperty('--tv-crossfade-incoming-cover');
    return;
  }

  const duration = Math.max(0.1, crossfade.durationSeconds);
  const progress = Math.max(0, Math.min(1, crossfade.elapsedSeconds / duration));
  const incoming = crossfade.incomingTrack;
  const cover = artworkUrl(incoming);

  root.setAttribute('data-tv-crossfade', 'true');
  root.style.setProperty('--tv-crossfade-outgoing-opacity', String(1 - progress));
  root.style.setProperty('--tv-crossfade-incoming-opacity', String(progress));
  root.style.setProperty('--tv-crossfade-incoming-title', cssString(incoming.title));
  root.style.setProperty('--tv-crossfade-incoming-artist', cssString(incoming.albumArtist || incoming.artist || 'Artista desconhecido'));
  root.style.setProperty('--tv-crossfade-incoming-cover', cover ? `url("${cover}")` : 'none');
}
