import { describe, expect, it } from 'vitest';
import {
  EMPTY_DJ_SYNC_STATE,
  activateDjSync,
  disableDjSyncForDeck,
  isDjSyncMaster,
  resetDjSyncForLoad,
  resolveDjSyncAfterDeckUnavailable
} from './dj-sync-state';

describe('DJ sync state', () => {
  it('faz o deck alvo seguir o outro como master', () => {
    const state = activateDjSync(EMPTY_DJ_SYNC_STATE, 'b', 'tempo');
    expect(state).toEqual({
      masterDeck: 'a',
      synced: { a: false, b: true },
      mode: 'tempo'
    });
    expect(isDjSyncMaster(state, 'a')).toBe(true);
  });

  it('troca master quando SYNC é ativado no outro deck', () => {
    const first = activateDjSync(EMPTY_DJ_SYNC_STATE, 'b', 'tempo');
    const second = activateDjSync(first, 'a', 'beat');
    expect(second).toEqual({
      masterDeck: 'b',
      synced: { a: true, b: false },
      mode: 'beat'
    });
  });

  it('ação manual no slave desliga apenas o sync', () => {
    const state = activateDjSync(EMPTY_DJ_SYNC_STATE, 'b', 'tempo');
    expect(disableDjSyncForDeck(state, 'b')).toEqual({
      masterDeck: 'a',
      synced: { a: false, b: false },
      mode: 'off'
    });
  });

  it('indisponibilidade do master limpa o estado inteiro', () => {
    const state = activateDjSync(EMPTY_DJ_SYNC_STATE, 'b', 'tempo');
    expect(resolveDjSyncAfterDeckUnavailable(state, 'a')).toEqual(EMPTY_DJ_SYNC_STATE);
  });

  it('LOAD no master ou slave remove estado fantasma', () => {
    const state = activateDjSync(EMPTY_DJ_SYNC_STATE, 'b', 'tempo');
    expect(resetDjSyncForLoad(state, 'a')).toEqual(EMPTY_DJ_SYNC_STATE);
    expect(resetDjSyncForLoad(state, 'b').synced.b).toBe(false);
  });
});
