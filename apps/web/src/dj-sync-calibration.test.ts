import { describe, expect, it } from 'vitest';
import type { TrackRhythm } from '@home-music/shared';
import type { BeatmatchPlan } from './beatmatch';
import {
  DJ_SYNC_CONTROL_INTERVAL_MS,
  DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA,
  resolveContinuousDjSyncCorrection
} from './dj-sync-continuous-lock';
import {
  DJ_SYNC_PHASE_DEADBAND_SECONDS,
  resolveInitialDjSyncPlan
} from './dj-sync-phase-lock';

const beatmatch: BeatmatchPlan = {
  playbackRate: 1,
  tempoFactor: 1,
  phaseLeadSeconds: 0
};

function rhythm(bpm: number, firstBeatSeconds = 0.25, beatsPerBar: 3 | 4 = 4): TrackRhythm {
  return {
    bpm,
    firstBeatSeconds,
    confidence: 0.95,
    downbeatSeconds: firstBeatSeconds,
    beatsPerBar,
    downbeatConfidence: 0.95
  };
}

function simulateContinuousLock(options: {
  bpm: number;
  durationSeconds: number;
  initialOffsetSeconds: number;
  naturalDriftRatio?: number;
}) {
  const masterRhythm = rhythm(options.bpm);
  const slaveRhythm = rhythm(options.bpm);
  const stepSeconds = DJ_SYNC_CONTROL_INTERVAL_MS / 1_000;
  const naturalDriftRatio = options.naturalDriftRatio ?? 1;
  let masterPosition = 20;
  let slavePosition = 20 + options.initialOffsetSeconds;
  let playbackRate = 1;
  let lastRelockAtMs: number | null = null;
  let nudges = 0;
  let relocks = 0;
  let maxRateDelta = 0;

  const totalSteps = Math.ceil(options.durationSeconds / stepSeconds);
  for (let step = 0; step < totalSteps; step += 1) {
    const nowMs = step * DJ_SYNC_CONTROL_INTERVAL_MS;
    const action = resolveContinuousDjSyncCorrection({
      masterRhythm,
      masterPositionSeconds: masterPosition,
      masterPlaybackRate: 1,
      slaveRhythm,
      slavePositionSeconds: slavePosition,
      beatmatch,
      nowMs,
      lastRelockAtMs
    });

    playbackRate = action.playbackRate;
    if (action.kind === 'relock') {
      slavePosition += action.offsetMediaSeconds;
      lastRelockAtMs = nowMs;
      relocks += 1;
    } else if (action.kind === 'nudge') {
      nudges += 1;
      maxRateDelta = Math.max(maxRateDelta, Math.abs(action.rateDelta));
    }

    masterPosition += stepSeconds;
    slavePosition += stepSeconds * playbackRate * naturalDriftRatio;
  }

  return {
    errorSeconds: slavePosition - masterPosition,
    nudges,
    relocks,
    maxRateDelta
  };
}

describe('DJ sync calibration matrix', () => {
  it.each([60, 90, 120, 128, 140, 174])(
    'mantém phase lock inicial previsível em %s BPM',
    bpm => {
      const masterRhythm = rhythm(bpm);
      const slaveRhythm = rhythm(bpm);
      const plan = resolveInitialDjSyncPlan({
        masterRhythm,
        masterPositionSeconds: 32,
        masterPlaybackRate: 1,
        slaveRhythm,
        slavePositionSeconds: 32.04,
        beatmatch
      });

      expect(plan.mode).toBe('bar');
      expect(plan.playbackRate).toBeCloseTo(1, 8);
      expect(plan.correction.kind).toBe('nudge');
      if (plan.correction.kind === 'nudge') {
        expect(Math.abs(plan.correction.phaseErrorSeconds)).toBeLessThanOrEqual(0.041);
      }
    }
  );

  it.each([3, 4] as const)(
    'usa downbeat para phase lock em compasso %s/4',
    beatsPerBar => {
      const track = rhythm(120, 0.37, beatsPerBar);
      const plan = resolveInitialDjSyncPlan({
        masterRhythm: track,
        masterPositionSeconds: 24.37,
        masterPlaybackRate: 1,
        slaveRhythm: track,
        slavePositionSeconds: 24.37,
        beatmatch
      });

      expect(plan.mode).toBe('bar');
      expect(plan.correction).toEqual({ kind: 'none' });
    }
  );

  it.each([30, 60, 120])(
    'mantém erro de fase dentro da deadband após %ss com drift leve',
    durationSeconds => {
      const result = simulateContinuousLock({
        bpm: 128,
        durationSeconds,
        initialOffsetSeconds: 0.06,
        naturalDriftRatio: 1.0002
      });

      expect(Math.abs(result.errorSeconds)).toBeLessThanOrEqual(
        DJ_SYNC_PHASE_DEADBAND_SECONDS + 0.004
      );
      expect(result.maxRateDelta).toBeLessThanOrEqual(DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA);
      expect(result.relocks).toBeLessThanOrEqual(1);
      expect(result.nudges).toBeGreaterThan(0);
    }
  );

  it('corrige fase nos dois sentidos sem hunting destrutivo', () => {
    for (const initialOffsetSeconds of [-0.06, 0.06]) {
      const result = simulateContinuousLock({
        bpm: 120,
        durationSeconds: 60,
        initialOffsetSeconds
      });
      expect(Math.abs(result.errorSeconds)).toBeLessThanOrEqual(0.015);
      expect(result.relocks).toBeLessThanOrEqual(1);
    }
  });

  it('degrada para tempo-only quando confidence fica abaixo do contrato', () => {
    const result = resolveContinuousDjSyncCorrection({
      masterRhythm: rhythm(128),
      masterPositionSeconds: 20,
      masterPlaybackRate: 1,
      slaveRhythm: { ...rhythm(128), confidence: 0.1 },
      slavePositionSeconds: 20.04,
      beatmatch,
      nowMs: 1_000,
      lastRelockAtMs: null
    });

    expect(result).toEqual({
      kind: 'tempo-only',
      playbackRate: 1,
      reason: 'invalid-grid'
    });
  });

  it('aceita override manual como grid confiável sem depender da confidence automática', () => {
    const manual: TrackRhythm = {
      bpm: 128,
      firstBeatSeconds: 0.42,
      confidence: 1,
      downbeatSeconds: 0.42,
      beatsPerBar: 4,
      downbeatConfidence: 1,
      manualOverride: true
    };
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: manual,
      masterPositionSeconds: 16.42,
      masterPlaybackRate: 1,
      slaveRhythm: manual,
      slavePositionSeconds: 16.42,
      beatmatch
    });

    expect(plan.mode).toBe('bar');
    expect(plan.correction).toEqual({ kind: 'none' });
  });
});
