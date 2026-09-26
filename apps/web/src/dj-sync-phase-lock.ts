import type { TrackRhythm } from '@home-music/shared';
import type { BeatmatchPlan } from './beatmatch';
import {
  hasUsableBarGrid,
  resolveGridPhaseError
} from './dj-beat-grid';

export const DJ_SYNC_PHASE_DEADBAND_SECONDS = 0.012;
export const DJ_SYNC_NUDGE_MAX_SECONDS = 0.08;
export const DJ_SYNC_MAX_INITIAL_SEEK_SECONDS = 1.5;
export const DJ_SYNC_NUDGE_RATE_DELTA = 0.018;
export const DJ_SYNC_NUDGE_DURATION_MS = 140;

export type InitialDjSyncCorrection =
  | { kind: 'none' }
  | {
      kind: 'nudge';
      direction: -1 | 1;
      rateMultiplier: number;
      durationMs: number;
      phaseErrorSeconds: number;
    }
  | {
      kind: 'seek';
      offsetMediaSeconds: number;
      phaseErrorSeconds: number;
    };

export type InitialDjSyncPlan = {
  mode: 'tempo' | 'beat' | 'bar';
  playbackRate: number;
  correction: InitialDjSyncCorrection;
};

export function rhythmWithTempoFactor(
  rhythm: TrackRhythm | null | undefined,
  factor: BeatmatchPlan['tempoFactor']
): TrackRhythm | null | undefined {
  if (!rhythm || factor === 1) return rhythm;
  return {
    ...rhythm,
    bpm: rhythm.bpm * factor,
    ...(rhythm.beatGrid
      ? {
          beatGrid: {
            ...rhythm.beatGrid,
            segments: rhythm.beatGrid.segments.map(segment => ({
              ...segment,
              bpm: segment.bpm * factor
            }))
          }
        }
      : {})
  };
}

function resolveCorrection(options: {
  phaseErrorSeconds: number;
  slavePlaybackRate: number;
}): InitialDjSyncCorrection {
  const errorSeconds = options.phaseErrorSeconds;
  const magnitude = Math.abs(errorSeconds);
  if (!Number.isFinite(magnitude) || magnitude <= DJ_SYNC_PHASE_DEADBAND_SECONDS) {
    return { kind: 'none' };
  }

  if (magnitude <= DJ_SYNC_NUDGE_MAX_SECONDS) {
    const direction: -1 | 1 = errorSeconds > 0 ? -1 : 1;
    return {
      kind: 'nudge',
      direction,
      rateMultiplier: 1 + (direction * DJ_SYNC_NUDGE_RATE_DELTA),
      durationMs: DJ_SYNC_NUDGE_DURATION_MS,
      phaseErrorSeconds: errorSeconds
    };
  }

  const offsetMediaSeconds = -errorSeconds * options.slavePlaybackRate;
  if (Math.abs(offsetMediaSeconds) > DJ_SYNC_MAX_INITIAL_SEEK_SECONDS) {
    return { kind: 'none' };
  }

  return {
    kind: 'seek',
    offsetMediaSeconds,
    phaseErrorSeconds: errorSeconds
  };
}

export function resolveInitialDjSyncPlan(options: {
  masterRhythm: TrackRhythm | null | undefined;
  masterPositionSeconds: number;
  masterPlaybackRate: number;
  slaveRhythm: TrackRhythm | null | undefined;
  slavePositionSeconds: number;
  beatmatch: BeatmatchPlan;
}): InitialDjSyncPlan {
  const slaveRhythm = rhythmWithTempoFactor(
    options.slaveRhythm,
    options.beatmatch.tempoFactor
  );

  const canUseBar = (
    options.beatmatch.tempoFactor === 1
    && hasUsableBarGrid(options.masterRhythm)
    && hasUsableBarGrid(slaveRhythm)
    && options.masterRhythm.beatsPerBar === slaveRhythm.beatsPerBar
  );

  if (canUseBar) {
    const error = resolveGridPhaseError({
      mode: 'bar',
      masterRhythm: options.masterRhythm,
      masterPositionSeconds: options.masterPositionSeconds,
      masterPlaybackRate: options.masterPlaybackRate,
      slaveRhythm,
      slavePositionSeconds: options.slavePositionSeconds,
      slavePlaybackRate: options.beatmatch.playbackRate
    });

    if (error) {
      const correction = resolveCorrection({
        phaseErrorSeconds: error.secondsDelta,
        slavePlaybackRate: options.beatmatch.playbackRate
      });
      if (
        correction.kind !== 'none'
        || Math.abs(error.secondsDelta) <= DJ_SYNC_PHASE_DEADBAND_SECONDS
      ) {
        return {
          mode: 'bar',
          playbackRate: options.beatmatch.playbackRate,
          correction
        };
      }
    }
  }

  const beatError = resolveGridPhaseError({
    mode: 'beat',
    masterRhythm: options.masterRhythm,
    masterPositionSeconds: options.masterPositionSeconds,
    masterPlaybackRate: options.masterPlaybackRate,
    slaveRhythm,
    slavePositionSeconds: options.slavePositionSeconds,
    slavePlaybackRate: options.beatmatch.playbackRate
  });

  if (!beatError) {
    return {
      mode: 'tempo',
      playbackRate: options.beatmatch.playbackRate,
      correction: { kind: 'none' }
    };
  }

  const correction = resolveCorrection({
    phaseErrorSeconds: beatError.secondsDelta,
    slavePlaybackRate: options.beatmatch.playbackRate
  });

  if (
    correction.kind === 'none'
    && Math.abs(beatError.secondsDelta) > DJ_SYNC_PHASE_DEADBAND_SECONDS
  ) {
    return {
      mode: 'tempo',
      playbackRate: options.beatmatch.playbackRate,
      correction: { kind: 'none' }
    };
  }

  return {
    mode: 'beat',
    playbackRate: options.beatmatch.playbackRate,
    correction
  };
}
