import { describe, expect, it } from 'vitest';
import type { TrackRhythm } from '@home-music/shared';
import type { BeatmatchPlan } from './beatmatch';
import {
  DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA,
  DJ_SYNC_CONTINUOUS_RELOCK_COOLDOWN_MS,
  resolveContinuousDjSyncCorrection
} from './dj-sync-continuous-lock';

const rhythm: TrackRhythm = {
  bpm: 120,
  firstBeatSeconds: 0,
  confidence: 0.95
};

const beatmatch: BeatmatchPlan = {
  playbackRate: 1,
  tempoFactor: 1,
  phaseLeadSeconds: 0
};

function correction(slavePositionSeconds: number, overrides: Partial<Parameters<typeof resolveContinuousDjSyncCorrection>[0]> = {}) {
  return resolveContinuousDjSyncCorrection({
    masterRhythm: rhythm,
    masterPositionSeconds: 10,
    masterPlaybackRate: 1,
    slaveRhythm: rhythm,
    slavePositionSeconds,
    beatmatch,
    nowMs: 5_000,
    lastRelockAtMs: null,
    ...overrides
  });
}

describe('continuous DJ sync controller', () => {
  it('fica no rate base dentro da deadband', () => {
    expect(correction(10.005)).toMatchObject({
      kind: 'hold',
      playbackRate: 1
    });
  });

  it('desacelera slave adiantado proporcionalmente ao erro', () => {
    const result = correction(10.04);
    expect(result.kind).toBe('nudge');
    if (result.kind === 'nudge') {
      expect(result.phaseErrorSeconds).toBeGreaterThan(0);
      expect(result.rateDelta).toBeLessThan(0);
      expect(Math.abs(result.rateDelta)).toBeLessThanOrEqual(DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA);
      expect(result.playbackRate).toBeLessThan(1);
    }
  });

  it('acelera slave atrasado proporcionalmente ao erro', () => {
    const result = correction(9.96);
    expect(result.kind).toBe('nudge');
    if (result.kind === 'nudge') {
      expect(result.phaseErrorSeconds).toBeLessThan(0);
      expect(result.rateDelta).toBeGreaterThan(0);
      expect(result.playbackRate).toBeGreaterThan(1);
    }
  });

  it('faz re-lock único para erro moderado', () => {
    const result = correction(10.15);
    expect(result.kind).toBe('relock');
    if (result.kind === 'relock') {
      expect(result.offsetMediaSeconds).toBeCloseTo(-0.15, 6);
    }
  });

  it('usa nudge máximo enquanto o cooldown de re-lock está ativo', () => {
    const result = correction(10.15, {
      nowMs: 5_000,
      lastRelockAtMs: 5_000 - DJ_SYNC_CONTINUOUS_RELOCK_COOLDOWN_MS + 1
    });
    expect(result.kind).toBe('nudge');
    if (result.kind === 'nudge') {
      expect(Math.abs(result.rateDelta)).toBeCloseTo(DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA, 8);
    }
  });

  it('degrada para tempo-only quando o erro é inseguro', () => {
    expect(correction(10.24)).toEqual({
      kind: 'tempo-only',
      playbackRate: 1,
      reason: 'unsafe-phase-error'
    });
  });

  it('degrada para tempo-only quando o grid não é confiável', () => {
    expect(correction(10.04, {
      slaveRhythm: { ...rhythm, confidence: 0.1 }
    })).toEqual({
      kind: 'tempo-only',
      playbackRate: 1,
      reason: 'invalid-grid'
    });
  });

  it('respeita half/double tempo ao medir fase', () => {
    const result = correction(10, {
      slaveRhythm: { ...rhythm, bpm: 60 },
      beatmatch: { playbackRate: 1, tempoFactor: 2, phaseLeadSeconds: 0 }
    });
    expect(result.kind).toBe('hold');
  });

  it('acompanha BPM local quando o grid variável muda de segmento', () => {
    const masterVariable: TrackRhythm = {
      ...rhythm,
      beatGrid: {
        version: 1,
        segments: [
          { startSeconds: 0, bpm: 120, firstBeatSeconds: 0, confidence: 0.95 },
          { startSeconds: 8, bpm: 122, firstBeatSeconds: 8, confidence: 0.95 }
        ]
      }
    };
    const slaveVariable: TrackRhythm = {
      ...rhythm,
      beatGrid: {
        version: 1,
        segments: [
          { startSeconds: 0, bpm: 120, firstBeatSeconds: 0, confidence: 0.95 },
          { startSeconds: 8, bpm: 119, firstBeatSeconds: 8, confidence: 0.95 }
        ]
      }
    };

    const result = correction(10, {
      masterRhythm: masterVariable,
      slaveRhythm: slaveVariable
    });

    expect(result.playbackRate).toBeCloseTo(122 / 119, 3);
  });

  it('mantém correção proporcional ao playbackRate base', () => {
    const result = correction(10.04, {
      slaveRhythm: { ...rhythm, bpm: 125 },
      beatmatch: { playbackRate: 0.96, tempoFactor: 1, phaseLeadSeconds: 0 }
    });
    expect(['hold', 'nudge', 'relock']).toContain(result.kind);
    expect(result.playbackRate).toBeGreaterThan(0.9);
    expect(result.playbackRate).toBeLessThan(1);
  });
});


describe('continuous DJ sync drift simulation', () => {
  function simulate(initialOffsetSeconds: number) {
    const stepSeconds = 0.08;
    let masterPosition = 20;
    let slavePosition = 20 + initialOffsetSeconds;
    let slaveRate = 1;
    let lastRelockAtMs: number | null = null;
    let signChanges = 0;
    let previousSign = Math.sign(initialOffsetSeconds);

    for (let step = 0; step < 160; step += 1) {
      const nowMs = step * stepSeconds * 1_000;
      const action = resolveContinuousDjSyncCorrection({
        masterRhythm: rhythm,
        masterPositionSeconds: masterPosition,
        masterPlaybackRate: 1,
        slaveRhythm: rhythm,
        slavePositionSeconds: slavePosition,
        beatmatch,
        nowMs,
        lastRelockAtMs
      });

      if (action.kind === 'relock') {
        slavePosition += action.offsetMediaSeconds;
        slaveRate = action.playbackRate;
        lastRelockAtMs = nowMs;
      } else if (action.kind === 'nudge' || action.kind === 'hold') {
        slaveRate = action.playbackRate;
      } else {
        slaveRate = action.playbackRate;
      }

      masterPosition += stepSeconds;
      slavePosition += stepSeconds * slaveRate;

      const error = slavePosition - masterPosition;
      const sign = Math.abs(error) < 0.012 ? 0 : Math.sign(error);
      if (sign !== 0 && previousSign !== 0 && sign !== previousSign) signChanges += 1;
      if (sign !== 0) previousSign = sign;
    }

    return {
      errorSeconds: slavePosition - masterPosition,
      signChanges
    };
  }

  it.each([0.06, -0.06])(
    'converge drift artificial de %ss para a deadband sem hunting',
    initialOffsetSeconds => {
      const result = simulate(initialOffsetSeconds);
      expect(Math.abs(result.errorSeconds)).toBeLessThanOrEqual(0.015);
      expect(result.signChanges).toBeLessThanOrEqual(1);
    }
  );
});
