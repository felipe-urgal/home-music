import type { OfflineDownloadRecord } from './offline-downloads';
import { offlineAudioCacheName } from './offline-downloads';
import { readOfflineUserId } from './offline-user';

export function offlineCachedStreamUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

export function offlineCachedStreamHref(
  trackId: string,
  origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
) {
  return new URL(offlineCachedStreamUrl(trackId), origin).href;
}

type OfflineColdStartOptions = {
  userId?: string | null;
  cacheStorage?: CacheStorage | null;
};

export async function readOfflineColdStartRecords(
  records: readonly OfflineDownloadRecord[],
  options: OfflineColdStartOptions = {}
): Promise<OfflineDownloadRecord[] | null> {
  if (records.length === 0) return [];

  const userId = options.userId === undefined ? readOfflineUserId() : options.userId;
  if (!userId) return null;

  const cacheStorage = options.cacheStorage === undefined
    ? (typeof window !== 'undefined' && 'caches' in window ? window.caches : null)
    : options.cacheStorage;
  if (!cacheStorage) return null;

  try {
    const cache = await cacheStorage.open(offlineAudioCacheName(userId));
    const cachedUrls = new Set((await cache.keys()).map(request => request.url));
    return records.filter(record => cachedUrls.has(offlineCachedStreamHref(record.track.id)));
  } catch {
    return null;
  }
}
