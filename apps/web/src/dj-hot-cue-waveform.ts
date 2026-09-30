import type { TrackHotCues } from '@home-music/shared';

export type DjHotCueWaveformMarker = {
  index: number;
  seconds: number;
  position: number;
  color: NonNullable<TrackHotCues['colors']>[number];
  label: string | null;
};

export function buildDjHotCueWaveformMarkers(
  hotCues: TrackHotCues['positions'] | null | undefined,
  durationSeconds: number,
  colors: TrackHotCues['colors'] | null | undefined = undefined,
  labels: TrackHotCues['labels'] | null | undefined = undefined
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
      position: Math.max(0, Math.min(1, seconds / durationSeconds)),
      color: colors?.[index] ?? null,
      label: labels?.[index] ?? null
    }];
  });
}
