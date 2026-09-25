import {
  MIN_RHYTHM_CONFIDENCE,
  type TrackRhythm
} from '@home-music/shared';

export { MIN_RHYTHM_CONFIDENCE };
export const QUANTIZED_CROSSFADE_ARM_SECONDS = 1.25;
export const QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS = 0.025;
export const MIN_QUANTIZED_CROSSFADE_SECONDS = 0.75;

function validRhythm(rhythm: TrackRhythm | null | undefined): rhythm is TrackRhythm {
  return Boolean(
    rhythm
    && Number.isFinite(rhythm.bpm)
    && rhythm.bpm > 0
    && Number.isFinite(rhythm.firstBeatSeconds)
    && rhythm.firstBeatSeconds >= 0
    && Number.isFinite(rhythm.confidence)
    && rhythm.confidence >= MIN_RHYTHM_CONFIDENCE
  );
}

export function beatDurationSeconds(rhythm: TrackRhythm | null | undefined) {
  if (!validRhythm(rhythm)) return null;
  return 60 / rhythm.bpm;
}

export function beatIndexAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  const beatDuration = beatDurationSeconds(rhythm);
  if (
    beatDuration == null
    || !Number.isFinite(positionSeconds)
    || positionSeconds < rhythm!.firstBeatSeconds
  ) return null;

  return Math.floor(
    ((positionSeconds - rhythm!.firstBeatSeconds) / beatDuration) + 1e-9
  );
}

export function nextBeatAtOrAfter(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  const beatDuration = beatDurationSeconds(rhythm);
  if (beatDuration == null || !Number.isFinite(positionSeconds) || positionSeconds < 0) return null;

  const firstBeat = rhythm!.firstBeatSeconds;
  if (positionSeconds <= firstBeat) return firstBeat;

  const beatsFromFirst = Math.ceil(
    ((positionSeconds - firstBeat) / beatDuration) - 1e-9
  );
  return firstBeat + (Math.max(0, beatsFromFirst) * beatDuration);
}

export type QuantizedCrossfadePlan = {
  startTimeSeconds: number;
  durationSeconds: number;
};

export function resolveQuantizedCrossfadePlan(options: {
  rhythm: TrackRhythm | null | undefined;
  trackDurationSeconds: number;
  preferredDurationSeconds: number;
}): QuantizedCrossfadePlan | null {
  const { rhythm, trackDurationSeconds, preferredDurationSeconds } = options;
  if (
    !validRhythm(rhythm)
    || !Number.isFinite(trackDurationSeconds)
    || trackDurationSeconds <= 0
    || !Number.isFinite(preferredDurationSeconds)
    || preferredDurationSeconds <= 0
    || preferredDurationSeconds >= trackDurationSeconds
  ) return null;

  const preferredStart = trackDurationSeconds - preferredDurationSeconds;
  const quantizedStart = nextBeatAtOrAfter(rhythm, preferredStart);
  if (quantizedStart == null || quantizedStart >= trackDurationSeconds) return null;

  const durationSeconds = trackDurationSeconds - quantizedStart;
  const minimumUsefulDuration = Math.max(
    MIN_QUANTIZED_CROSSFADE_SECONDS,
    preferredDurationSeconds * 0.5
  );
  if (durationSeconds < minimumUsefulDuration) return null;

  return {
    startTimeSeconds: quantizedStart,
    durationSeconds
  };
}
