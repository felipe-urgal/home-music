import { describe, expect, it } from 'vitest';
import type { TrackRhythm } from '@home-music/shared';
import {
  canPhaseAlignBeatmatch,
  interpolatePlaybackRate,
  resolveBeatmatchPlan
} from './beatmatch';

function rhythm(bpm: number, firstBeatSeconds = 0.3, confidence = 0.9): TrackRhythm {
  return { bpm, firstBeatSeconds, confidence };
}

describe('beatmatch planning', () => {
  it('calcula playbackRate para BPMs próximos', () => {
    const plan = resolveBeatmatchPlan({
      outgoing: rhythm(128),
      incoming: rhythm(124)
    });

    expect(plan?.playbackRate).toBeCloseTo(128 / 124, 6);
    expect(plan?.tempoFactor).toBe(1);
  });

  it('normaliza ambiguidade half-time e double-time sem acelerar 2x', () => {
    expect(resolveBeatmatchPlan({
      outgoing: rhythm(128),
      incoming: rhythm(64)
    })).toMatchObject({
      playbackRate: 1,
      tempoFactor: 2
    });

    expect(resolveBeatmatchPlan({
      outgoing: rhythm(64),
      incoming: rhythm(128)
    })).toMatchObject({
      playbackRate: 1,
      tempoFactor: 0.5
    });
  });

  it('recusa diferença acima do limite conservador', () => {
    expect(resolveBeatmatchPlan({
      outgoing: rhythm(128),
      incoming: rhythm(110)
    })).toBeNull();
  });

  it('recusa análise de baixa confiança', () => {
    expect(resolveBeatmatchPlan({
      outgoing: rhythm(128, 0.2, 0.3),
      incoming: rhythm(126)
    })).toBeNull();
  });

  it('calcula quanto antes o deck de entrada precisaria tocar para alinhar sua primeira batida', () => {
    const plan = resolveBeatmatchPlan({
      outgoing: rhythm(128),
      incoming: rhythm(124, 0.4)
    });

    expect(plan).not.toBeNull();
    expect(plan?.phaseLeadSeconds).toBeCloseTo(0.4 / (128 / 124), 6);
    expect(canPhaseAlignBeatmatch(plan)).toBe(true);
  });

  it('não tenta alinhamento de fase quando o intro exige pre-roll longo', () => {
    const plan = resolveBeatmatchPlan({
      outgoing: rhythm(128),
      incoming: rhythm(128, 4)
    });

    expect(plan).not.toBeNull();
    expect(canPhaseAlignBeatmatch(plan)).toBe(false);
  });

  it('restaura playbackRate de forma monotônica até 1', () => {
    expect(interpolatePlaybackRate(1.04, 0, 4)).toBeCloseTo(1.04);
    expect(interpolatePlaybackRate(1.04, 2, 4)).toBeCloseTo(1.02);
    expect(interpolatePlaybackRate(1.04, 4, 4)).toBeCloseTo(1);
    expect(interpolatePlaybackRate(0.96, 2, 4)).toBeCloseTo(0.98);
    expect(interpolatePlaybackRate(0.96, 8, 4)).toBeCloseTo(1);
  });
});
