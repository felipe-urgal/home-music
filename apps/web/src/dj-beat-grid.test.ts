import { describe, expect, it } from 'vitest';
import type { TrackRhythm } from '@home-music/shared';
import {
  barAtIndex,
  barGridPositionAt,
  beatAtIndex,
  beatGridPositionAt,
  hasUsableBarGrid,
  hasUsableBeatGrid,
  nearestBarAt,
  nearestBeatAt,
  nextBeatAfter,
  resolveGridPhaseError,
  shortestCircularPhaseDelta
} from './dj-beat-grid';

const rhythm: TrackRhythm = {
  bpm: 120,
  firstBeatSeconds: 0.25,
  confidence: 0.95,
  downbeatSeconds: 0.25,
  beatsPerBar: 4,
  downbeatConfidence: 0.95
};

describe('DJ beat grid', () => {
  it('expõe índice e fase do beat inclusive antes do primeiro beat', () => {
    expect(beatGridPositionAt(rhythm, 0.25)).toMatchObject({ beatIndex: 0, phase: 0 });
    expect(beatGridPositionAt(rhythm, 0.5)).toMatchObject({ beatIndex: 0, phase: 0.5 });
    expect(beatGridPositionAt(rhythm, 0.75)).toMatchObject({ beatIndex: 1, phase: 0 });

    const before = beatGridPositionAt(rhythm, 0.1);
    expect(before?.beatIndex).toBe(-1);
    expect(before?.phase).toBeCloseTo(0.7, 6);
  });

  it('calcula duração efetiva do beat usando playbackRate', () => {
    const position = beatGridPositionAt(rhythm, 1, 1.25);
    expect(position?.beatDurationSeconds).toBeCloseTo(0.5, 6);
    expect(position?.effectiveBeatDurationSeconds).toBeCloseTo(0.4, 6);
  });

  it('resolve beat por índice, mais próximo e próximo estritamente posterior', () => {
    expect(beatAtIndex(rhythm, 0)).toBeCloseTo(0.25, 6);
    expect(beatAtIndex(rhythm, 3)).toBeCloseTo(1.75, 6);
    expect(nearestBeatAt(rhythm, 0.1)).toBeCloseTo(0.25, 6);
    expect(nearestBeatAt(rhythm, 1.49)).toBeCloseTo(1.25, 6);
    expect(nextBeatAfter(rhythm, 1.25)).toBeCloseTo(1.75, 6);
    expect(nextBeatAfter(rhythm, 0.1)).toBeCloseTo(0.25, 6);
  });

  it('modela compassos 4/4 com downbeat confiável', () => {
    const position = barGridPositionAt(rhythm, 2.75);
    expect(position?.barIndex).toBe(1);
    expect(position?.beatInBar).toBe(1);
    expect(position?.barPhase).toBeCloseTo(0.25, 6);
    expect(barAtIndex(rhythm, 2)).toBeCloseTo(4.25, 6);
    expect(nearestBarAt(rhythm, 3.9)).toBeCloseTo(4.25, 6);
  });

  it('modela compassos 3/4', () => {
    const threeFour: TrackRhythm = {
      ...rhythm,
      beatsPerBar: 3
    };
    const position = barGridPositionAt(threeFour, 1.75);
    expect(position?.barIndex).toBe(1);
    expect(position?.beatInBar).toBe(0);
    expect(position?.barPhase).toBe(0);
  });

  it('calcula o menor erro circular de fase nas bordas 0/1', () => {
    expect(shortestCircularPhaseDelta(0.95, 0.05)).toBeCloseTo(0.1, 6);
    expect(shortestCircularPhaseDelta(0.05, 0.95)).toBeCloseTo(-0.1, 6);
    expect(shortestCircularPhaseDelta(0.25, 0.25)).toBe(0);
  });

  it('converte erro de beat em segundos considerando rate efetivo do slave', () => {
    const error = resolveGridPhaseError({
      mode: 'beat',
      masterRhythm: rhythm,
      masterPositionSeconds: 1.25,
      slaveRhythm: rhythm,
      slavePositionSeconds: 1.35,
      slavePlaybackRate: 1.25
    });

    expect(error?.masterPhase).toBe(0);
    expect(error?.slavePhase).toBeCloseTo(0.2, 6);
    expect(error?.phaseDelta).toBeCloseTo(0.2, 6);
    expect(error?.secondsDelta).toBeCloseTo(0.08, 6);
    expect(error?.correctionSeconds).toBeCloseTo(-0.08, 6);
  });

  it('calcula erro por compasso separadamente do beat', () => {
    const error = resolveGridPhaseError({
      mode: 'bar',
      masterRhythm: rhythm,
      masterPositionSeconds: 2.25,
      slaveRhythm: rhythm,
      slavePositionSeconds: 2.75
    });

    expect(error?.masterPhase).toBe(0);
    expect(error?.slavePhase).toBeCloseTo(0.25, 6);
    expect(error?.phaseDelta).toBeCloseTo(0.25, 6);
    expect(error?.secondsDelta).toBeCloseTo(0.5, 6);
  });

  it('rejeita análise/rate inválidos e downbeat de baixa confiança', () => {
    expect(hasUsableBeatGrid({ ...rhythm, confidence: 0.1 })).toBe(false);
    expect(hasUsableBarGrid({ ...rhythm, downbeatConfidence: 0.1 })).toBe(false);
    expect(beatGridPositionAt({ ...rhythm, bpm: 0 }, 1)).toBeNull();
    expect(beatGridPositionAt(rhythm, 1, 0)).toBeNull();
    expect(resolveGridPhaseError({
      mode: 'bar',
      masterRhythm: { ...rhythm, downbeatConfidence: 0.1 },
      masterPositionSeconds: 1,
      slaveRhythm: rhythm,
      slavePositionSeconds: 1
    })).toBeNull();
  });
});
