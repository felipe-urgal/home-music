const sources = new Map<string, string>();

export function setTvRemoteMediaSource(trackId: string, blob: Blob) {
  const previous = sources.get(trackId);
  if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob);
  sources.set(trackId, url);
  return url;
}

export function getTvRemoteMediaSource(trackId: string) {
  return sources.get(trackId) ?? null;
}

export function clearTvRemoteMediaSources() {
  for (const url of sources.values()) URL.revokeObjectURL(url);
  sources.clear();
}
