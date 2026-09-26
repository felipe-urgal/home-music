import { describe, expect, it } from 'vitest';
import type { TrackRhythm } from '@home-music/shared';
import {
  beatDurationSeconds,
  beatIndexAt,
  nextBarAtOrAfter,
  nextBeatAtOrAfter,
  quantizedCrossfadeWakeDelayMs,
  resolveQuantizedCrossfadePlan
} from './beat-clock';

const rhythm: TrackRhythm = {
  bpm: 120,
  firstBeatSeconds: 0.25,
  confidence: 0.9
};

describe('beat clock', () => {
  it('calcula wake-up antecipado antes da janela fina do crossfade', () => {
    expect(quantizedCrossfadeWakeDelayMs(8.75)).toBe(7_500);
    expect(quantizedCrossfadeWakeDelayMs(2)).toBe(750);
    expect(quantizedCrossfadeWakeDelayMs(1.26)).toBeCloseTo(10, 6);
    expect(quantizedCrossfadeWakeDelayMs(1.25)).toBe(0);
    expect(quantizedCrossfadeWakeDelayMs(0.5)).toBe(0);
    expect(quantizedCrossfadeWakeDelayMs(Number.NaN)).toBe(0);
  });

  it('calcula duração e índice do beat a partir da fase analisada', () => {
    expect(beatDurationSeconds(rhythm)).toBeCloseTo(0.5, 6);
    expect(beatIndexAt(rhythm, 0.25)).toBe(0);
    expect(beatIndexAt(rhythm, 1.24)).toBe(1);
    expect(beatIndexAt(rhythm, 1.25)).toBe(2);
  });

  it('resolve a próxima batida sem pular quando já está na grade', () => {
    expect(nextBeatAtOrAfter(rhythm, 0.1)).toBeCloseTo(0.25, 6);
    expect(nextBeatAtOrAfter(rhythm, 0.25)).toBeCloseTo(0.25, 6);
    expect(nextBeatAtOrAfter(rhythm, 0.26)).toBeCloseTo(0.75, 6);
    expect(nextBeatAtOrAfter(rhythm, 1.25)).toBeCloseTo(1.25, 6);
  });

  it('recusa ritmo de baixa confiança ou valores inválidos', () => {
    expect(beatDurationSeconds({ ...rhythm, confidence: 0.2 })).toBeNull();
    expect(nextBeatAtOrAfter({ ...rhythm, bpm: 0 }, 10)).toBeNull();
    expect(beatIndexAt(rhythm, -1)).toBeNull();
  });

  it('calcula o próximo início de compasso somente com downbeat confiável', () => {
    const barRhythm: TrackRhythm = {
      ...rhythm,
      downbeatSeconds: 0.25,
      beatsPerBar: 4,
      downbeatConfidence: 0.9
    };
    expect(nextBarAtOrAfter(barRhythm, 0.1)).toBeCloseTo(0.25, 6);
    expect(nextBarAtOrAfter(barRhythm, 0.26)).toBeCloseTo(2.25, 6);
    expect(nextBarAtOrAfter(barRhythm, 2.25)).toBeCloseTo(2.25, 6);
    expect(nextBarAtOrAfter({ ...barRhythm, downbeatConfidence: 0.3 }, 1)).toBeNull();
  });

  it('prefere downbeat quando o início de compasso fica perto da janela alvo', () => {
    const plan = resolveQuantizedCrossfadePlan({
      rhythm: {
        ...rhythm,
        downbeatSeconds: 0.25,
        beatsPerBar: 4,
        downbeatConfidence: 0.9
      },
      trackDurationSeconds: 60,
      preferredDurationSeconds: 5
    });

    expect(plan).not.toBeNull();
    expect(plan?.startTimeSeconds).toBeCloseTo(56.25, 6);
    expect(plan?.durationSeconds).toBeCloseTo(3.75, 6);
  });

  it('cai para beat quando o próximo compasso deslocaria demais o crossfade', () => {
    const plan = resolveQuantizedCrossfadePlan({
      rhythm: {
        ...rhythm,
        downbeatSeconds: 0.25,
        beatsPerBar: 4,
        downbeatConfidence: 0.9
      },
      trackDurationSeconds: 59.6,
      preferredDurationSeconds: 5
    });

    expect(plan).not.toBeNull();
    expect(plan?.startTimeSeconds).toBeCloseTo(54.75, 6);
    expect(plan?.durationSeconds).toBeCloseTo(4.85, 6);
  });

  it('move o início do crossfade para a próxima batida e preserva o fim da faixa', () => {
    const plan = resolveQuantizedCrossfadePlan({
      rhythm,
      trackDurationSeconds: 60,
      preferredDurationSeconds: 5
    });

    expect(plan).not.toBeNull();
    expect(plan?.startTimeSeconds).toBeCloseTo(55.25, 6);
    expect(plan?.durationSeconds).toBeCloseTo(4.75, 6);
  });

  it('faz fallback quando quantizar deixaria o crossfade curto demais', () => {
    const slowRhythm: TrackRhythm = {
      bpm: 60,
      firstBeatSeconds: 0.95,
      confidence: 0.9
    };
    expect(resolveQuantizedCrossfadePlan({
      rhythm: slowRhythm,
      trackDurationSeconds: 10,
      preferredDurationSeconds: 1
    })).toBeNull();
  });

  it('faz fallback sem análise confiável', () => {
    expect(resolveQuantizedCrossfadePlan({
      rhythm: undefined,
      trackDurationSeconds: 60,
      preferredDurationSeconds: 5
    })).toBeNull();
    expect(resolveQuantizedCrossfadePlan({
      rhythm: { ...rhythm, confidence: 0.3 },
      trackDurationSeconds: 60,
      preferredDurationSeconds: 5
    })).toBeNull();
  });
});
