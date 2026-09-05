import { describe, expect, it } from 'vitest';
import type { AccountOpenSubsonicKey } from './account-client';
import { reconcileOpenSubsonicKeySnapshot } from './open-subsonic-key-state';

function key(id: string): AccountOpenSubsonicKey {
  return {
    id,
    name: `App ${id}`,
    hint: `hm_os_…${id}`,
    createdAt: '2026-09-05T00:00:00.000Z'
  };
}

describe('reconcileOpenSubsonicKeySnapshot', () => {
  it('preserva chave criada depois que a listagem inicial começou', () => {
    const current = [key('new')];
    const staleSnapshot = [key('existing')];

    expect(reconcileOpenSubsonicKeySnapshot(current, staleSnapshot, new Set()).map(item => item.id))
      .toEqual(['new', 'existing']);
  });

  it('não reintroduz chave revogada por snapshot antigo', () => {
    const current = [key('kept')];
    const staleSnapshot = [key('revoked'), key('kept')];

    expect(reconcileOpenSubsonicKeySnapshot(current, staleSnapshot, new Set(['revoked'])).map(item => item.id))
      .toEqual(['kept']);
  });

  it('não duplica uma chave presente no estado atual e no snapshot', () => {
    const current = [key('same')];
    const staleSnapshot = [key('same')];

    expect(reconcileOpenSubsonicKeySnapshot(current, staleSnapshot, new Set())).toHaveLength(1);
  });
});
