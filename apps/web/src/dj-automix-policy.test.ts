import { describe, expect, it } from 'vitest';
import {
  effectiveDjAutomixDuration,
  shouldStartDjAutomixTransition
} from './dj-automix-policy';

describe('DJ AutoMix policy', () => {
  it('inicia no ponto quantizado respeitando a tolerância', () => {
    expect(shouldStartDjAutomixTransition({
      currentTimeSeconds: 91.9,
      durationSeconds: 120,
      crossfadeSeconds: 8,
      quantizedStartTimeSeconds: 92,
      earlyToleranceSeconds: 0.15
    })).toBe(true);
    expect(shouldStartDjAutomixTransition({
      currentTimeSeconds: 91,
      durationSeconds: 120,
      crossfadeSeconds: 8,
      quantizedStartTimeSeconds: 92,
      earlyToleranceSeconds: 0.15
    })).toBe(false);
  });

  it('usa a janela de crossfade quando não há plano quantizado', () => {
    expect(shouldStartDjAutomixTransition({
      currentTimeSeconds: 112,
      durationSeconds: 120,
      crossfadeSeconds: 8
    })).toBe(true);
    expect(shouldStartDjAutomixTransition({
      currentTimeSeconds: 111,
      durationSeconds: 120,
      crossfadeSeconds: 8
    })).toBe(false);
  });

  it('faz handoff no fim mesmo com crossfade 0s', () => {
    expect(shouldStartDjAutomixTransition({
      currentTimeSeconds: 119.9,
      durationSeconds: 120,
      crossfadeSeconds: 0
    })).toBe(true);
    expect(effectiveDjAutomixDuration(0)).toBe(0.25);
  });
});
