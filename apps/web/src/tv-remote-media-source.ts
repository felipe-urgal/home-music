const sources = new Map<string, string>();
const MAX_TRANSIENT_MEDIA_SOURCES = 3;

export function setTvRemoteMediaSource(trackId: string, blob: Blob) {
  const previous = sources.get(trackId);
  if (previous) {
    URL.revokeObjectURL(previous);
    sources.delete(trackId);
  }
  const url = URL.createObjectURL(blob);
  sources.set(trackId, url);

  while (sources.size > MAX_TRANSIENT_MEDIA_SOURCES) {
    const oldest = sources.entries().next().value as [string, string] | undefined;
    if (!oldest) break;
    sources.delete(oldest[0]);
    URL.revokeObjectURL(oldest[1]);
  }
  return url;
}

export function getTvRemoteMediaSource(trackId: string) {
  return sources.get(trackId) ?? null;
}

export function filterTracksWithTvRemoteMediaSource<T extends { id: string }>(tracks: T[]) {
  return tracks.filter(track => sources.has(track.id));
}

export function clearTvRemoteMediaSources() {
  for (const url of sources.values()) URL.revokeObjectURL(url);
  sources.clear();
}
