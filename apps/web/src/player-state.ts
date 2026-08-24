import type { PlaybackState, RepeatMode, Track } from '@home-music/shared';

export type RestoredPlayerState = {
  baseQueue: Track[];
  queue: Track[];
  currentTrackId: string | null;
  position: number;
};

export function uniqueTracksById(tracks: Track[]) {
  const seen = new Set<string>();
  return tracks.filter(track => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

export function remapQueue(items: Track[], trackMap: Map<string, Track>) {
  return items
    .map(item => trackMap.get(item.id))
    .filter((track): track is Track => Boolean(track));
}

export function restorePlayerState(tracks: Track[], state: PlaybackState): RestoredPlayerState {
  const trackMap = new Map(tracks.map(track => [track.id, track]));
  const queueFromIds = (ids: string[]) => ids
    .map(id => trackMap.get(id))
    .filter((track): track is Track => Boolean(track));

  const restoredQueue = queueFromIds(state.queueIds);
  const restoredBaseQueue = queueFromIds(state.baseQueueIds);
  const queue = restoredQueue.length ? restoredQueue : tracks;
  const baseQueue = restoredBaseQueue.length
    ? restoredBaseQueue
    : state.shuffle
      ? uniqueTracksById(queue).sort((a, b) =>
        tracks.findIndex(track => track.id === a.id) - tracks.findIndex(track => track.id === b.id)
      )
      : queue;

  const savedTrackIsValid = Boolean(state.currentTrackId && trackMap.has(state.currentTrackId));
  const currentTrackId = savedTrackIsValid
    ? state.currentTrackId
    : queue[0]?.id ?? null;

  return {
    baseQueue,
    queue,
    currentTrackId,
    position: savedTrackIsValid ? Math.max(0, state.position) : 0
  };
}

export function nextTrackDecision(
  queue: Track[],
  currentIndex: number,
  repeatMode: RepeatMode,
  fromEnded: boolean
): { type: 'track'; id: string } | { type: 'restart' } | { type: 'stop' } {
  if (!queue.length || currentIndex < 0) return { type: 'stop' };

  if (fromEnded && repeatMode === 'one') return { type: 'restart' };
  if (repeatMode === 'all' && queue.length === 1) return { type: 'restart' };
  if (currentIndex < queue.length - 1) return { type: 'track', id: queue[currentIndex + 1].id };
  if (repeatMode === 'all') return { type: 'track', id: queue[0].id };
  return { type: 'stop' };
}
