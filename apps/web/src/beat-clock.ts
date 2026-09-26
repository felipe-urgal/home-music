import {
  MIN_DOWNBEAT_CONFIDENCE,
  MIN_RHYTHM_CONFIDENCE,
  type TrackRhythm
} from '@home-music/shared';

export { MIN_DOWNBEAT_CONFIDENCE, MIN_RHYTHM_CONFIDENCE };
export const QUANTIZED_CROSSFADE_ARM_SECONDS = 1.25;
export const QUANTIZED_CROSSFADE_EARLY_TOLERANCE_SECONDS = 0.025;
export const MIN_QUANTIZED_CROSSFADE_SECONDS = 0.75;
export const MAX_BAR_QUANTIZATION_SHIFT_SECONDS = 1.25;
export const MAX_BAR_QUANTIZATION_SHIFT_RATIO = 0.35;

export function quantizedCrossfadeWakeDelayMs(timeUntilStartSeconds: number) {
  if (!Number.isFinite(timeUntilStartSeconds)) return 0;
  return Math.max(
    0,
    (timeUntilStartSeconds - QUANTIZED_CROSSFADE_ARM_SECONDS) * 1_000
  );
}

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

function validDownbeat(rhythm: TrackRhythm | null | undefined): rhythm is TrackRhythm & {
  downbeatSeconds: number;
  beatsPerBar: 3 | 4;
  downbeatConfidence: number;
} {
  return Boolean(
    validRhythm(rhythm)
    && typeof rhythm.downbeatSeconds === 'number'
    && Number.isFinite(rhythm.downbeatSeconds)
    && rhythm.downbeatSeconds >= 0
    && (rhythm.beatsPerBar === 3 || rhythm.beatsPerBar === 4)
    && typeof rhythm.downbeatConfidence === 'number'
    && Number.isFinite(rhythm.downbeatConfidence)
    && rhythm.downbeatConfidence >= MIN_DOWNBEAT_CONFIDENCE
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

export function nextBarAtOrAfter(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  const beatDuration = beatDurationSeconds(rhythm);
  if (
    beatDuration == null
    || !validDownbeat(rhythm)
    || !Number.isFinite(positionSeconds)
    || positionSeconds < 0
  ) return null;

  const barDuration = beatDuration * rhythm.beatsPerBar;
  if (positionSeconds <= rhythm.downbeatSeconds) return rhythm.downbeatSeconds;

  const barsFromDownbeat = Math.ceil(
    ((positionSeconds - rhythm.downbeatSeconds) / barDuration) - 1e-9
  );
  return rhythm.downbeatSeconds + (Math.max(0, barsFromDownbeat) * barDuration);
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
  const beatStart = nextBeatAtOrAfter(rhythm, preferredStart);
  if (beatStart == null || beatStart >= trackDurationSeconds) return null;

  const minimumUsefulDuration = Math.max(
    MIN_QUANTIZED_CROSSFADE_SECONDS,
    preferredDurationSeconds * 0.5
  );
  const usefulPlan = (startTimeSeconds: number) => {
    if (startTimeSeconds >= trackDurationSeconds) return null;
    const durationSeconds = trackDurationSeconds - startTimeSeconds;
    if (durationSeconds < minimumUsefulDuration) return null;
    return { startTimeSeconds, durationSeconds };
  };

  const barStart = nextBarAtOrAfter(rhythm, preferredStart);
  if (barStart != null) {
    const maximumBarShift = Math.min(
      MAX_BAR_QUANTIZATION_SHIFT_SECONDS,
      preferredDurationSeconds * MAX_BAR_QUANTIZATION_SHIFT_RATIO
    );
    if (barStart - preferredStart <= maximumBarShift + 1e-9) {
      const barPlan = usefulPlan(barStart);
      if (barPlan) return barPlan;
    }
  }

  return usefulPlan(beatStart);
}
