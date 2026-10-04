import { describe, expect, it } from 'vitest';
import { shouldScheduleAutoHide } from './useAutoHideControls';

describe('player auto-hide controls', () => {
  it('não agenda ocultação enquanto algum controle mantém foco', () => {
    expect(shouldScheduleAutoHide(true, true)).toBe(false);
  });

  it('agenda ocultação somente quando está tocando e sem foco interno', () => {
    expect(shouldScheduleAutoHide(true, false)).toBe(true);
    expect(shouldScheduleAutoHide(false, false)).toBe(false);
  });
});
