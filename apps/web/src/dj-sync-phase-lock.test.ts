import { describe, expect, it } from 'vitest';
import type { TrackRhythm } from '@home-music/shared';
import type { BeatmatchPlan } from './beatmatch';
import {
  DJ_SYNC_NUDGE_MAX_SECONDS,
  resolveInitialDjSyncPlan
} from './dj-sync-phase-lock';

const master: TrackRhythm = {
  bpm: 120,
  firstBeatSeconds: 0,
  confidence: 0.95,
  downbeatSeconds: 0,
  beatsPerBar: 4,
  downbeatConfidence: 0.95
};

const beatmatch: BeatmatchPlan = {
  playbackRate: 1,
  tempoFactor: 1,
  phaseLeadSeconds: 0
};

describe('initial DJ phase lock', () => {
  it('prefere bar lock quando downbeats são confiáveis e compatíveis', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: master,
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: master,
      slavePositionSeconds: 8,
      beatmatch
    });

    expect(plan.mode).toBe('bar');
    expect(plan.correction.kind).toBe('none');
  });

  it('usa nudge para erro pequeno de fase', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: { ...master, downbeatConfidence: 0.1 },
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: { ...master, downbeatConfidence: 0.1 },
      slavePositionSeconds: 8.04,
      beatmatch
    });

    expect(plan.mode).toBe('beat');
    expect(plan.correction.kind).toBe('nudge');
    if (plan.correction.kind === 'nudge') {
      expect(Math.abs(plan.correction.phaseErrorSeconds)).toBeLessThanOrEqual(
        DJ_SYNC_NUDGE_MAX_SECONDS
      );
      expect(plan.correction.direction).toBe(-1);
    }
  });

  it('usa nudge no sentido oposto quando o slave está atrasado', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: { ...master, downbeatConfidence: 0.1 },
      masterPositionSeconds: 8.04,
      masterPlaybackRate: 1,
      slaveRhythm: { ...master, downbeatConfidence: 0.1 },
      slavePositionSeconds: 8,
      beatmatch
    });

    expect(plan.mode).toBe('beat');
    expect(plan.correction.kind).toBe('nudge');
    if (plan.correction.kind === 'nudge') {
      expect(plan.correction.direction).toBe(1);
      expect(plan.correction.phaseErrorSeconds).toBeLessThan(0);
    }
  });

  it('usa seek limitado para erro moderado', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: { ...master, downbeatConfidence: 0.1 },
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: { ...master, downbeatConfidence: 0.1 },
      slavePositionSeconds: 8.18,
      beatmatch
    });

    expect(plan.mode).toBe('beat');
    expect(plan.correction.kind).toBe('seek');
    if (plan.correction.kind === 'seek') {
      expect(plan.correction.offsetMediaSeconds).toBeCloseTo(-0.18, 6);
    }
  });

  it('faz fallback para tempo-only quando grid não é confiável', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: { ...master, confidence: 0.1 },
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: master,
      slavePositionSeconds: 8.2,
      beatmatch
    });

    expect(plan).toEqual({
      mode: 'tempo',
      playbackRate: 1,
      correction: { kind: 'none' }
    });
  });

  it('trata half/double tempo como beat lock e evita bar lock', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: master,
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: { ...master, bpm: 60 },
      slavePositionSeconds: 8,
      beatmatch: {
        playbackRate: 1,
        tempoFactor: 2,
        phaseLeadSeconds: 0
      }
    });

    expect(plan.mode).toBe('beat');
  });

  it('converte correção temporal para offset de mídia usando playbackRate', () => {
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: { ...master, downbeatConfidence: 0.1 },
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: { ...master, bpm: 125, downbeatConfidence: 0.1 },
      slavePositionSeconds: 8.2,
      beatmatch: {
        playbackRate: 0.96,
        tempoFactor: 1,
        phaseLeadSeconds: 0
      }
    });

    if (plan.correction.kind === 'seek') {
      expect(Math.abs(plan.correction.offsetMediaSeconds)).toBeLessThan(0.5);
    } else {
      expect(['nudge', 'none']).toContain(plan.correction.kind);
    }
  });

  it('degrada para tempo-only quando a correção inicial seria destrutiva', () => {
    const slowMaster: TrackRhythm = {
      ...master,
      bpm: 15,
      downbeatConfidence: 0.1
    };
    const plan = resolveInitialDjSyncPlan({
      masterRhythm: slowMaster,
      masterPositionSeconds: 8,
      masterPlaybackRate: 1,
      slaveRhythm: slowMaster,
      slavePositionSeconds: 10,
      beatmatch: {
        playbackRate: 1,
        tempoFactor: 1,
        phaseLeadSeconds: 0
      }
    });

    expect(plan.mode).toBe('tempo');
    expect(plan.correction).toEqual({ kind: 'none' });
  });

});
