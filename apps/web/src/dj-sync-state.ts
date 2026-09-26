import type { DjDeckId } from './dj-controller-contract';

export type DjSyncMode = 'off' | 'tempo' | 'beat' | 'bar';

export type DjSyncState = {
  masterDeck: DjDeckId | null;
  synced: Record<DjDeckId, boolean>;
  mode: DjSyncMode;
};

export const EMPTY_DJ_SYNC_STATE: DjSyncState = {
  masterDeck: null,
  synced: { a: false, b: false },
  mode: 'off'
};

function otherDeck(deck: DjDeckId): DjDeckId {
  return deck === 'a' ? 'b' : 'a';
}

export function activateDjSync(
  state: DjSyncState,
  slaveDeck: DjDeckId,
  mode: Exclude<DjSyncMode, 'off'> = 'tempo'
): DjSyncState {
  const masterDeck = otherDeck(slaveDeck);
  return {
    masterDeck,
    synced: {
      a: slaveDeck === 'a',
      b: slaveDeck === 'b'
    },
    mode
  };
}

export function disableDjSyncForDeck(
  state: DjSyncState,
  deck: DjDeckId
): DjSyncState {
  if (!state.synced[deck] && state.masterDeck !== deck) return state;

  if (state.masterDeck === deck) {
    return EMPTY_DJ_SYNC_STATE;
  }

  return EMPTY_DJ_SYNC_STATE;
}

export function resetDjSyncForLoad(
  state: DjSyncState,
  deck: DjDeckId
): DjSyncState {
  return disableDjSyncForDeck(state, deck);
}

export function resolveDjSyncAfterDeckUnavailable(
  state: DjSyncState,
  deck: DjDeckId
): DjSyncState {
  if (state.masterDeck === deck) return EMPTY_DJ_SYNC_STATE;
  if (state.synced[deck]) return disableDjSyncForDeck(state, deck);
  return state;
}

export function isDjSyncMaster(state: DjSyncState, deck: DjDeckId) {
  return state.masterDeck === deck;
}
