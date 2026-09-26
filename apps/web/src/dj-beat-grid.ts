import {
  MIN_DOWNBEAT_CONFIDENCE,
  MIN_RHYTHM_CONFIDENCE,
  type TrackRhythm
} from '@home-music/shared';

const EPSILON = 1e-9;

export type BeatGridPosition = {
  beatIndex: number;
  segmentIndex: number | null;
  phase: number;
  beatDurationSeconds: number;
  effectiveBeatDurationSeconds: number;
};

export type BarGridPosition = {
  barIndex: number;
  beatInBar: number;
  barPhase: number;
  barDurationSeconds: number;
  effectiveBarDurationSeconds: number;
};

export type GridPhaseError = {
  mode: 'beat' | 'bar';
  masterPhase: number;
  slavePhase: number;
  phaseDelta: number;
  secondsDelta: number;
  correctionSeconds: number;
};

function positiveModulo(value: number, modulo: number) {
  const remainder = value % modulo;
  return remainder < 0 ? remainder + modulo : remainder;
}

function normalizeUnitPhase(value: number) {
  const phase = positiveModulo(value, 1);
  return phase >= 1 - EPSILON || phase < EPSILON ? 0 : phase;
}

function validPlaybackRate(playbackRate: number) {
  return Number.isFinite(playbackRate) && playbackRate > 0;
}

export function beatGridSegmentAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  const segments = rhythm?.beatGrid?.segments;
  if (!segments?.length || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return null;
  }

  let selectedIndex = 0;
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index]!.startSeconds > positionSeconds) break;
    selectedIndex = index;
  }
  return {
    segment: segments[selectedIndex]!,
    index: selectedIndex
  };
}

export function beatGridBpmAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  const selected = beatGridSegmentAt(rhythm, positionSeconds);
  return selected?.segment.bpm ?? rhythm?.bpm ?? null;
}

function beatSpecAt(
  rhythm: TrackRhythm,
  positionSeconds: number
) {
  const selected = beatGridSegmentAt(rhythm, positionSeconds);
  if (!selected) {
    return {
      bpm: rhythm.bpm,
      firstBeatSeconds: rhythm.firstBeatSeconds,
      confidence: rhythm.confidence,
      segmentIndex: null as number | null
    };
  }

  return {
    bpm: selected.segment.bpm,
    firstBeatSeconds: selected.segment.firstBeatSeconds,
    confidence: selected.segment.confidence,
    segmentIndex: selected.index
  };
}

export function hasUsableBeatGrid(
  rhythm: TrackRhythm | null | undefined
): rhythm is TrackRhythm {
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

export function hasUsableBarGrid(
  rhythm: TrackRhythm | null | undefined
): rhythm is TrackRhythm & {
  downbeatSeconds: number;
  beatsPerBar: 3 | 4;
  downbeatConfidence: number;
} {
  return Boolean(
    hasUsableBeatGrid(rhythm)
    && !rhythm.beatGrid?.segments?.length
    && typeof rhythm.downbeatSeconds === 'number'
    && Number.isFinite(rhythm.downbeatSeconds)
    && rhythm.downbeatSeconds >= 0
    && (rhythm.beatsPerBar === 3 || rhythm.beatsPerBar === 4)
    && typeof rhythm.downbeatConfidence === 'number'
    && Number.isFinite(rhythm.downbeatConfidence)
    && rhythm.downbeatConfidence >= MIN_DOWNBEAT_CONFIDENCE
  );
}

export function beatGridPositionAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number,
  playbackRate = 1
): BeatGridPosition | null {
  if (
    !hasUsableBeatGrid(rhythm)
    || !Number.isFinite(positionSeconds)
    || positionSeconds < 0
    || !validPlaybackRate(playbackRate)
  ) return null;

  const spec = beatSpecAt(rhythm, positionSeconds);
  if (
    !Number.isFinite(spec.bpm)
    || spec.bpm <= 0
    || !Number.isFinite(spec.firstBeatSeconds)
    || spec.firstBeatSeconds < 0
    || !Number.isFinite(spec.confidence)
    || spec.confidence < MIN_RHYTHM_CONFIDENCE
  ) return null;

  const beatDurationSeconds = 60 / spec.bpm;
  const relativeBeats = (positionSeconds - spec.firstBeatSeconds) / beatDurationSeconds;
  const rounded = Math.round(relativeBeats);
  const stableRelative = Math.abs(relativeBeats - rounded) <= EPSILON
    ? rounded
    : relativeBeats;

  return {
    beatIndex: Math.floor(stableRelative),
    segmentIndex: spec.segmentIndex,
    phase: normalizeUnitPhase(stableRelative),
    beatDurationSeconds,
    effectiveBeatDurationSeconds: beatDurationSeconds / playbackRate
  };
}

export function beatAtIndex(
  rhythm: TrackRhythm | null | undefined,
  beatIndex: number
) {
  if (
    !hasUsableBeatGrid(rhythm)
    || !Number.isInteger(beatIndex)
    || beatIndex < 0
  ) return null;

  return rhythm.firstBeatSeconds + (beatIndex * (60 / rhythm.bpm));
}

export function nearestBeatAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  if (
    !hasUsableBeatGrid(rhythm)
    || !Number.isFinite(positionSeconds)
    || positionSeconds < 0
  ) return null;

  const spec = beatSpecAt(rhythm, positionSeconds);
  if (spec.confidence < MIN_RHYTHM_CONFIDENCE) return null;
  const beatDurationSeconds = 60 / spec.bpm;
  const relativeBeats = (positionSeconds - spec.firstBeatSeconds) / beatDurationSeconds;
  const beatIndex = Math.round(relativeBeats);
  return Math.max(0, spec.firstBeatSeconds + (beatIndex * beatDurationSeconds));
}

export function nextBeatAfter(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  if (
    !hasUsableBeatGrid(rhythm)
    || !Number.isFinite(positionSeconds)
    || positionSeconds < 0
  ) return null;

  const spec = beatSpecAt(rhythm, positionSeconds);
  if (spec.confidence < MIN_RHYTHM_CONFIDENCE) return null;
  const beatDurationSeconds = 60 / spec.bpm;
  if (positionSeconds < spec.firstBeatSeconds - EPSILON) {
    return spec.firstBeatSeconds;
  }

  const relativeBeats = (positionSeconds - spec.firstBeatSeconds) / beatDurationSeconds;
  const beatIndex = Math.floor(relativeBeats + EPSILON) + 1;
  return Math.max(0, spec.firstBeatSeconds + (beatIndex * beatDurationSeconds));
}

export function barGridPositionAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number,
  playbackRate = 1
): BarGridPosition | null {
  if (
    !hasUsableBarGrid(rhythm)
    || !Number.isFinite(positionSeconds)
    || positionSeconds < 0
    || !validPlaybackRate(playbackRate)
  ) return null;

  const beatDurationSeconds = 60 / rhythm.bpm;
  const barDurationSeconds = beatDurationSeconds * rhythm.beatsPerBar;
  const relativeBars = (positionSeconds - rhythm.downbeatSeconds) / barDurationSeconds;
  const roundedBars = Math.round(relativeBars);
  const stableBars = Math.abs(relativeBars - roundedBars) <= EPSILON
    ? roundedBars
    : relativeBars;
  const relativeBeats = (positionSeconds - rhythm.downbeatSeconds) / beatDurationSeconds;
  const beatIndexFromDownbeat = Math.floor(relativeBeats + EPSILON);

  return {
    barIndex: Math.floor(stableBars),
    beatInBar: positiveModulo(beatIndexFromDownbeat, rhythm.beatsPerBar),
    barPhase: normalizeUnitPhase(stableBars),
    barDurationSeconds,
    effectiveBarDurationSeconds: barDurationSeconds / playbackRate
  };
}

export function barAtIndex(
  rhythm: TrackRhythm | null | undefined,
  barIndex: number
) {
  if (
    !hasUsableBarGrid(rhythm)
    || !Number.isInteger(barIndex)
    || barIndex < 0
  ) return null;

  const barDurationSeconds = (60 / rhythm.bpm) * rhythm.beatsPerBar;
  return rhythm.downbeatSeconds + (barIndex * barDurationSeconds);
}

export function nearestBarAt(
  rhythm: TrackRhythm | null | undefined,
  positionSeconds: number
) {
  if (
    !hasUsableBarGrid(rhythm)
    || !Number.isFinite(positionSeconds)
    || positionSeconds < 0
  ) return null;

  const barDurationSeconds = (60 / rhythm.bpm) * rhythm.beatsPerBar;
  const relativeBars = (positionSeconds - rhythm.downbeatSeconds) / barDurationSeconds;
  const barIndex = Math.max(0, Math.round(relativeBars));
  return barAtIndex(rhythm, barIndex);
}

export function shortestCircularPhaseDelta(masterPhase: number, slavePhase: number) {
  if (
    !Number.isFinite(masterPhase)
    || !Number.isFinite(slavePhase)
  ) return null;

  const master = normalizeUnitPhase(masterPhase);
  const slave = normalizeUnitPhase(slavePhase);
  let delta = slave - master;
  if (delta >= 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return Math.abs(delta) < EPSILON ? 0 : delta;
}

export function resolveGridPhaseError(options: {
  mode: 'beat' | 'bar';
  masterRhythm: TrackRhythm | null | undefined;
  masterPositionSeconds: number;
  masterPlaybackRate?: number;
  slaveRhythm: TrackRhythm | null | undefined;
  slavePositionSeconds: number;
  slavePlaybackRate?: number;
}): GridPhaseError | null {
  const masterRate = options.masterPlaybackRate ?? 1;
  const slaveRate = options.slavePlaybackRate ?? 1;

  if (options.mode === 'bar') {
    const master = barGridPositionAt(
      options.masterRhythm,
      options.masterPositionSeconds,
      masterRate
    );
    const slave = barGridPositionAt(
      options.slaveRhythm,
      options.slavePositionSeconds,
      slaveRate
    );
    if (!master || !slave) return null;

    const phaseDelta = shortestCircularPhaseDelta(master.barPhase, slave.barPhase);
    if (phaseDelta == null) return null;
    const secondsDelta = phaseDelta * slave.effectiveBarDurationSeconds;
    return {
      mode: 'bar',
      masterPhase: master.barPhase,
      slavePhase: slave.barPhase,
      phaseDelta,
      secondsDelta,
      correctionSeconds: -secondsDelta
    };
  }

  const master = beatGridPositionAt(
    options.masterRhythm,
    options.masterPositionSeconds,
    masterRate
  );
  const slave = beatGridPositionAt(
    options.slaveRhythm,
    options.slavePositionSeconds,
    slaveRate
  );
  if (!master || !slave) return null;

  const phaseDelta = shortestCircularPhaseDelta(master.phase, slave.phase);
  if (phaseDelta == null) return null;
  const secondsDelta = phaseDelta * slave.effectiveBeatDurationSeconds;
  return {
    mode: 'beat',
    masterPhase: master.phase,
    slavePhase: slave.phase,
    phaseDelta,
    secondsDelta,
    correctionSeconds: -secondsDelta
  };
}
