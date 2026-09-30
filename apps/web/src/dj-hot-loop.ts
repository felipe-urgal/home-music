import type { TrackRhythm } from '@home-music/shared';
import { beatGridBpmAt } from './dj-beat-grid';
import { DJ_LOOP_BEAT_SIZES, type DjLoopBeatSize } from './dj-loop-operations';

export type DjHotLoopPlan = {
  startSeconds: number;
  endSeconds: number;
  beats: DjLoopBeatSize;
};

export function resolveDjHotLoopPlan(options: {
  cueSeconds: number;
  durationSeconds: number | null | undefined;
  rhythm: TrackRhythm | null | undefined;
  beats: DjLoopBeatSize;
}): DjHotLoopPlan | null {
  if (
    !Number.isFinite(options.cueSeconds)
    || options.cueSeconds < 0
    || !DJ_LOOP_BEAT_SIZES.includes(options.beats)
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
