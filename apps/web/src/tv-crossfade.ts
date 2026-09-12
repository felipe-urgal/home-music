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
