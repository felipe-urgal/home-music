import type { TrackHotCues } from '@home-music/shared';

export type DjHotCueWaveformMarker = {
  index: number;
  seconds: number;
  position: number;
};

export function buildDjHotCueWaveformMarkers(
  hotCues: TrackHotCues['positions'] | null | undefined,
  durationSeconds: number
): DjHotCueWaveformMarker[] {
  if (
    !hotCues
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
  ) return [];

  return hotCues.flatMap((seconds, index) => {
    if (
      seconds == null
      || !Number.isFinite(seconds)
      || seconds < 0
      || seconds > durationSeconds
    ) return [];

    return [{
      index,
      seconds,
      position: Math.max(0, Math.min(1, seconds / durationSeconds))
    }];
  });
}
