import type { Track } from '@home-music/shared';
import type { DjDeckPanelState } from './components/DjModeScreen';
import type { DjDeckId } from './dj-controller-contract';
import { isDjSyncMaster, type DjSyncState } from './dj-sync-state';

export function buildDjDeckPanelState(options: {
  deck: DjDeckId;
  snapshot: DjDeckPanelState['snapshot'];
  tracksById: ReadonlyMap<string, Track>;
  cuePointSeconds: number | null;
  syncState: DjSyncState;
  channelVolume: number;
  meterLevel: number;
}): DjDeckPanelState {
  const {
    deck,
    snapshot,
    tracksById,
    cuePointSeconds,
    syncState,
    channelVolume,
    meterLevel
  } = options;

  return {
    snapshot,
    track: snapshot?.trackId ? tracksById.get(snapshot.trackId) ?? null : null,
    cuePointSeconds,
    syncActive: syncState.synced[deck],
    syncMaster: isDjSyncMaster(syncState, deck),
    syncMode: syncState.mode,
    channelVolume,
    meterLevel
  };
}
