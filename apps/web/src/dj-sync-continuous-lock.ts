import type { TrackRhythm } from '@home-music/shared';
import type { BeatmatchPlan } from './beatmatch';
import { MAX_BEATMATCH_RATE_DELTA } from './beatmatch';
import { beatGridBpmAt, resolveGridPhaseError } from './dj-beat-grid';
import {
  DJ_SYNC_PHASE_DEADBAND_SECONDS,
  rhythmWithTempoFactor
} from './dj-sync-phase-lock';

export const DJ_SYNC_CONTROL_INTERVAL_MS = 80;
export const DJ_SYNC_CONTINUOUS_MAX_ERROR_SECONDS = 0.1;
export const DJ_SYNC_CONTINUOUS_RELOCK_MAX_ERROR_SECONDS = 0.22;
export const DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA = 0.012;
export const DJ_SYNC_CONTINUOUS_RELOCK_COOLDOWN_MS = 1_000;

export type ContinuousDjSyncCorrection =
  | {
      kind: 'hold';
      phaseErrorSeconds: number;
      playbackRate: number;
    }
  | {
      kind: 'nudge';
      phaseErrorSeconds: number;
      playbackRate: number;
      rateDelta: number;
    }
  | {
      kind: 'relock';
      phaseErrorSeconds: number;
      playbackRate: number;
      offsetMediaSeconds: number;
    }
  | {
      kind: 'tempo-only';
      playbackRate: number;
      reason: 'invalid-grid' | 'unsafe-phase-error';
    };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function resolveContinuousDjSyncCorrection(options: {
  masterRhythm: TrackRhythm | null | undefined;
  masterPositionSeconds: number;
  masterPlaybackRate: number;
  slaveRhythm: TrackRhythm | null | undefined;
  slavePositionSeconds: number;
  beatmatch: BeatmatchPlan;
  nowMs: number;
  lastRelockAtMs: number | null;
}): ContinuousDjSyncCorrection {
  const slaveRhythm = rhythmWithTempoFactor(
    options.slaveRhythm,
    options.beatmatch.tempoFactor
  );

  const masterLocalBpm = beatGridBpmAt(
    options.masterRhythm,
    options.masterPositionSeconds
  );
  const slaveLocalBpm = beatGridBpmAt(
    slaveRhythm,
    options.slavePositionSeconds
  );

  let baseRate = options.beatmatch.playbackRate;
  if (
    typeof masterLocalBpm === 'number'
    && Number.isFinite(masterLocalBpm)
    && masterLocalBpm > 0
    && typeof slaveLocalBpm === 'number'
    && Number.isFinite(slaveLocalBpm)
    && slaveLocalBpm > 0
  ) {
    const localRate = masterLocalBpm / slaveLocalBpm;
    if (
      Number.isFinite(localRate)
      && localRate > 0
      && Math.abs(localRate - 1) <= MAX_BEATMATCH_RATE_DELTA
    ) {
      baseRate = localRate;
    }
  }
  const error = resolveGridPhaseError({
    mode: 'beat',
    masterRhythm: options.masterRhythm,
    masterPositionSeconds: options.masterPositionSeconds,
    masterPlaybackRate: options.masterPlaybackRate,
    slaveRhythm,
    slavePositionSeconds: options.slavePositionSeconds,
    slavePlaybackRate: baseRate
  });

  if (!error) {
    return {
      kind: 'tempo-only',
      playbackRate: baseRate,
      reason: 'invalid-grid'
    };
  }

  const phaseErrorSeconds = error.secondsDelta;
  const magnitude = Math.abs(phaseErrorSeconds);
  if (magnitude <= DJ_SYNC_PHASE_DEADBAND_SECONDS) {
    return {
      kind: 'hold',
      phaseErrorSeconds,
      playbackRate: baseRate
    };
  }

  if (magnitude <= DJ_SYNC_CONTINUOUS_MAX_ERROR_SECONDS) {
    const normalized = clamp(
      magnitude / DJ_SYNC_CONTINUOUS_MAX_ERROR_SECONDS,
      0,
      1
    );
    const signedDelta = (
      phaseErrorSeconds > 0 ? -1 : 1
    ) * normalized * DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA;
    return {
      kind: 'nudge',
      phaseErrorSeconds,
      playbackRate: baseRate * (1 + signedDelta),
      rateDelta: signedDelta
    };
  }

  if (magnitude <= DJ_SYNC_CONTINUOUS_RELOCK_MAX_ERROR_SECONDS) {
    const cooldownElapsed = (
      options.lastRelockAtMs == null
      || options.nowMs - options.lastRelockAtMs >= DJ_SYNC_CONTINUOUS_RELOCK_COOLDOWN_MS
    );

    if (cooldownElapsed) {
      return {
        kind: 'relock',
        phaseErrorSeconds,
        playbackRate: baseRate,
        offsetMediaSeconds: -phaseErrorSeconds * baseRate
      };
    }

    const signedDelta = (
      phaseErrorSeconds > 0 ? -1 : 1
    ) * DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA;
    return {
      kind: 'nudge',
      phaseErrorSeconds,
      playbackRate: baseRate * (1 + signedDelta),
      rateDelta: signedDelta
    };
  }

  return {
    kind: 'tempo-only',
    playbackRate: baseRate,
    reason: 'unsafe-phase-error'
  };
}
