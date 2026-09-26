import {
  MIN_RHYTHM_CONFIDENCE,
  type TrackBeatGrid,
  type TrackBeatGridSegment,
  type TrackRhythm
} from '@home-music/shared';

export const VARIABLE_GRID_MIN_WINDOWS = 4;
export const VARIABLE_GRID_MIN_SPAN_RATIO = 0.018;
export const VARIABLE_GRID_MAX_ADJACENT_RATIO = 0.08;
export const VARIABLE_GRID_MERGE_RATIO = 0.004;
export const VARIABLE_GRID_MAX_SEGMENTS = 24;

export type RhythmWindowEstimate = {
  startSeconds: number;
  bpm: number;
  firstBeatSeconds: number;
  confidence: number;
};

function relativeDifference(left: number, right: number) {
  const base = Math.max(1e-9, Math.abs(right));
  return Math.abs(left - right) / base;
}

export function normalizeWindowBpm(bpm: number, referenceBpm: number) {
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(referenceBpm) || referenceBpm <= 0) {
    return null;
  }

  const candidates = [bpm * 0.5, bpm, bpm * 2];
  let best = candidates[0]!;
  let bestDistance = relativeDifference(best, referenceBpm);
  for (const candidate of candidates.slice(1)) {
    const distance = relativeDifference(candidate, referenceBpm);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function deriveVariableBeatGrid(
  globalRhythm: TrackRhythm,
  windows: readonly RhythmWindowEstimate[]
): TrackBeatGrid | null {
  if (
    !Number.isFinite(globalRhythm.bpm)
    || globalRhythm.bpm <= 0
    || windows.length < VARIABLE_GRID_MIN_WINDOWS
  ) return null;

  const normalized = windows
    .filter(window => (
      Number.isFinite(window.startSeconds)
      && window.startSeconds >= 0
      && Number.isFinite(window.firstBeatSeconds)
      && window.firstBeatSeconds >= 0
      && Number.isFinite(window.confidence)
      && window.confidence >= MIN_RHYTHM_CONFIDENCE
    ))
    .map(window => {
      const bpm = normalizeWindowBpm(window.bpm, globalRhythm.bpm);
      return bpm == null ? null : { ...window, bpm };
    })
    .filter((window): window is RhythmWindowEstimate => window != null)
    .sort((left, right) => left.startSeconds - right.startSeconds);

  if (normalized.length < VARIABLE_GRID_MIN_WINDOWS) return null;

  for (let index = 1; index < normalized.length; index += 1) {
    if (
      relativeDifference(
        normalized[index]!.bpm,
        normalized[index - 1]!.bpm
      ) > VARIABLE_GRID_MAX_ADJACENT_RATIO
    ) return null;
  }

  const bpms = normalized.map(window => window.bpm);
  const minimum = Math.min(...bpms);
  const maximum = Math.max(...bpms);
  if (relativeDifference(maximum, minimum) < VARIABLE_GRID_MIN_SPAN_RATIO) return null;

  const segments: TrackBeatGridSegment[] = [];
  for (const window of normalized) {
    const previous = segments.at(-1);
    if (
      previous
      && relativeDifference(window.bpm, previous.bpm) <= VARIABLE_GRID_MERGE_RATIO
    ) {
      previous.bpm = Number(((previous.bpm + window.bpm) / 2).toFixed(3));
      previous.confidence = Number(Math.max(previous.confidence, window.confidence).toFixed(4));
      continue;
    }

    segments.push({
      startSeconds: Number(window.startSeconds.toFixed(3)),
      bpm: Number(window.bpm.toFixed(3)),
      firstBeatSeconds: Number(window.firstBeatSeconds.toFixed(4)),
      confidence: Number(window.confidence.toFixed(4))
    });
  }

  if (segments.length < 2) return null;
  if (segments.length > VARIABLE_GRID_MAX_SEGMENTS) {
    const stride = (segments.length - 1) / (VARIABLE_GRID_MAX_SEGMENTS - 1);
    const compact: TrackBeatGridSegment[] = [];
    for (let index = 0; index < VARIABLE_GRID_MAX_SEGMENTS; index += 1) {
      compact.push(segments[Math.round(index * stride)]!);
    }
    return { version: 1, segments: compact };
  }

  return { version: 1, segments };
}
