import type { PlaybackState } from '@home-music/shared';

export type PlaybackStateSnapshot = Omit<PlaybackState, 'updatedAt'>;
export type PlaybackPersistReason = 'state-change' | 'heartbeat' | 'lifecycle';

export type PlaybackStateSaveResult =
  | { status: 'ok'; state: PlaybackState }
  | { status: 'conflict'; state: PlaybackState }
  | { status: 'error' };

export function createPlaybackStateWriteCoordinator(
  initialUpdatedAt: string,
  save: (state: PlaybackState) => Promise<PlaybackStateSaveResult>
) {
  let updatedAt = initialUpdatedAt;
  let latestGeneration = 0;
  let blockedByRemoteConflict = false;
  let tail = Promise.resolve();

  async function write(
    snapshot: PlaybackStateSnapshot,
    reason: PlaybackPersistReason,
    generation: number
  ) {
    if (generation < latestGeneration) return;
    if (blockedByRemoteConflict && reason !== 'state-change') return;

    const first = await save({ ...snapshot, updatedAt });
    if (first.status === 'error') return;

    updatedAt = first.state.updatedAt;
    if (first.status === 'ok') {
      blockedByRemoteConflict = false;
      return;
    }

    blockedByRemoteConflict = true;
    if (reason !== 'state-change' || generation < latestGeneration) return;

    const retry = await save({ ...snapshot, updatedAt });
    if (retry.status === 'error') return;

    updatedAt = retry.state.updatedAt;
    blockedByRemoteConflict = retry.status === 'conflict';
  }

  return {
    setVersion(nextUpdatedAt: string) {
      updatedAt = nextUpdatedAt;
      blockedByRemoteConflict = false;
    },
    persist(snapshot: PlaybackStateSnapshot, reason: PlaybackPersistReason) {
      const generation = ++latestGeneration;
      const run = () => write(snapshot, reason, generation);
      tail = tail.then(run, run);
      return tail;
    }
  };
}
