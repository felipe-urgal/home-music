import type { TrackRhythm } from '@home-music/shared';
import { beatGridBpmAt, nearestBeatAt } from './dj-beat-grid';

export const DJ_LOOP_BEAT_SIZES = [0.5, 1, 2, 4, 8, 16] as const;
export type DjLoopBeatSize = (typeof DJ_LOOP_BEAT_SIZES)[number];

export type DjLoopRange = {
  startSeconds: number;
  endSeconds: number;
  beats: DjLoopBeatSize;
  quantized: boolean;
};

function safeDuration(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function clampPosition(positionSeconds: number, durationSeconds: number | null) {
  if (!Number.isFinite(positionSeconds)) return 0;
  const value = Math.max(0, positionSeconds);
  return durationSeconds == null ? value : Math.min(value, durationSeconds);
}

function beatDurationAt(rhythm: TrackRhythm | null | undefined, positionSeconds: number) {
  const bpm = beatGridBpmAt(rhythm, positionSeconds);
  return bpm != null && Number.isFinite(bpm) && bpm > 0 ? 60 / bpm : null;
}

export function resolveDjLoopPoint(options: {
  positionSeconds: number;
  durationSeconds: number | null | undefined;
  rhythm: TrackRhythm | null | undefined;
  quantize: boolean;
}) {
  const duration = safeDuration(options.durationSeconds);
  const raw = clampPosition(options.positionSeconds, duration);
  if (!options.quantize) return { seconds: raw, quantized: false };

  const snapped = nearestBeatAt(options.rhythm, raw);
  if (snapped == null) return { seconds: raw, quantized: false };
  return {
    seconds: clampPosition(snapped, duration),
    quantized: true
  };
}

export function resizeDjLoop(options: {
  loopIn: number;
  loopOut: number;
  rhythm: TrackRhythm | null | undefined;
  durationSeconds: number | null | undefined;
  beats: DjLoopBeatSize;
}): DjLoopRange | null {
  if (
    !Number.isFinite(options.loopIn)
    || !Number.isFinite(options.loopOut)
    || options.loopIn < 0
    || options.loopOut <= options.loopIn
    || !DJ_LOOP_BEAT_SIZES.includes(options.beats)
  ) return null;

  const duration = safeDuration(options.durationSeconds);
  const beatDuration = beatDurationAt(options.rhythm, options.loopIn)
    ?? ((options.loopOut - options.loopIn) / Math.max(0.5, options.beats));
  if (!Number.isFinite(beatDuration) || beatDuration <= 0) return null;

  const endSeconds = clampPosition(
    options.loopIn + (beatDuration * options.beats),
    duration
  );
  if (endSeconds <= options.loopIn + 1e-6) return null;

  return {
    startSeconds: options.loopIn,
    endSeconds,
    beats: options.beats,
    quantized: beatDurationAt(options.rhythm, options.loopIn) != null
  };
}

export function moveDjLoop(options: {
  loopIn: number;
  loopOut: number;
  rhythm: TrackRhythm | null | undefined;
  durationSeconds: number | null | undefined;
  direction: -1 | 1;
  beats?: number;
}): { startSeconds: number; endSeconds: number; quantized: boolean } | null {
  if (
    !Number.isFinite(options.loopIn)
    || !Number.isFinite(options.loopOut)
    || options.loopIn < 0
    || options.loopOut <= options.loopIn
  ) return null;

  const duration = safeDuration(options.durationSeconds);
  const amount = Math.max(0.5, Number.isFinite(options.beats) ? options.beats ?? 1 : 1);
  const beatDuration = beatDurationAt(
    options.rhythm,
    options.direction > 0 ? options.loopOut : options.loopIn
  ) ?? ((options.loopOut - options.loopIn) / 4);
  if (!Number.isFinite(beatDuration) || beatDuration <= 0) return null;

  const delta = beatDuration * amount * options.direction;
  const length = options.loopOut - options.loopIn;
  let startSeconds = options.loopIn + delta;
  let endSeconds = options.loopOut + delta;

  if (startSeconds < 0) {
    startSeconds = 0;
    endSeconds = length;
  }
  if (duration != null && endSeconds > duration) {
    endSeconds = duration;
    startSeconds = Math.max(0, duration - length);
  }

  if (endSeconds <= startSeconds + 1e-6) return null;

  return {
    startSeconds,
    endSeconds,
    quantized: beatDurationAt(options.rhythm, startSeconds) != null
  };
}
