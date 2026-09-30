import type { TrackRhythm } from '@home-music/shared';
import { beatGridBpmAt, nearestBeatAt } from './dj-beat-grid';
import { DJ_LOOP_BEAT_SIZES, type DjLoopBeatSize } from './dj-loop-operations';

export type DjAutoLoopPlan = {
  startSeconds: number;
  endSeconds: number;
  beats: DjLoopBeatSize;
  quantized: boolean;
};

export function resolveDjAutoLoopPlan(options: {
  positionSeconds: number;
  durationSeconds: number | null | undefined;
  rhythm: TrackRhythm | null | undefined;
  beats: DjLoopBeatSize;
}) : DjAutoLoopPlan | null {
  const { rhythm } = options;
  if (
    !Number.isFinite(options.positionSeconds)
    || options.positionSeconds < 0
    || !DJ_LOOP_BEAT_SIZES.includes(options.beats)
  ) return null;

  const duration = (
    options.durationSeconds != null
    && Number.isFinite(options.durationSeconds)
    && options.durationSeconds > 0
  ) ? options.durationSeconds : null;

  const rawStart = duration == null
    ? options.positionSeconds
    : Math.min(options.positionSeconds, duration);
  const snappedStart = nearestBeatAt(rhythm, rawStart);
  const startSeconds = snappedStart ?? rawStart;
  const bpm = beatGridBpmAt(rhythm, startSeconds);

  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return null;

  const rawEnd = startSeconds + ((60 / bpm) * options.beats);
  const endSeconds = duration == null ? rawEnd : Math.min(rawEnd, duration);
  if (endSeconds <= startSeconds + 1e-6) return null;

  return {
    startSeconds,
    endSeconds,
    beats: options.beats,
    quantized: snappedStart != null
  };
}

export function djLoopWaveformRange(options: {
  loopIn: number | null;
  loopOut: number | null;
  durationSeconds: number;
}) {
  if (
    options.loopIn == null
    || options.loopOut == null
    || !Number.isFinite(options.durationSeconds)
    || options.durationSeconds <= 0
    || options.loopIn < 0
    || options.loopOut <= options.loopIn
  ) return null;

  const start = Math.max(0, Math.min(1, options.loopIn / options.durationSeconds));
  const end = Math.max(start, Math.min(1, options.loopOut / options.durationSeconds));
  return { start, end };
}
