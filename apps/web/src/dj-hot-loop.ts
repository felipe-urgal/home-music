import type { TrackRhythm } from '@home-music/shared';
import { beatGridBpmAt } from './dj-beat-grid';

export type DjHotLoopPlan = {
  startSeconds: number;
  endSeconds: number;
  beats: number;
};

export function resolveDjHotLoopPlan(options: {
  cueSeconds: number;
  durationSeconds: number | null | undefined;
  rhythm: TrackRhythm | null | undefined;
  beats: number;
}): DjHotLoopPlan | null {
  if (
    !Number.isFinite(options.cueSeconds)
    || options.cueSeconds < 0
    || !Number.isInteger(options.beats)
    || ![1, 2, 4, 8, 16].includes(options.beats)
  ) return null;

  const duration = (
    options.durationSeconds != null
    && Number.isFinite(options.durationSeconds)
    && options.durationSeconds > 0
  ) ? options.durationSeconds : null;

  const startSeconds = duration == null
    ? options.cueSeconds
    : Math.min(options.cueSeconds, duration);
  const bpm = beatGridBpmAt(options.rhythm, startSeconds);
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;

  const rawEnd = startSeconds + ((60 / bpm) * options.beats);
  const endSeconds = duration == null ? rawEnd : Math.min(rawEnd, duration);
  if (endSeconds <= startSeconds + 1e-6) return null;

  return { startSeconds, endSeconds, beats: options.beats };
}
