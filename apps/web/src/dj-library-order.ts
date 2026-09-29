export function movePlayedDjTracksToEnd<T extends { id: string }>(
  tracks: readonly T[],
  playedTrackIds: ReadonlySet<string>
) {
  if (!playedTrackIds.size) return [...tracks];

  const unplayed: T[] = [];
  const played: T[] = [];
  for (const track of tracks) {
    (playedTrackIds.has(track.id) ? played : unplayed).push(track);
  }
  return [...unplayed, ...played];
}
