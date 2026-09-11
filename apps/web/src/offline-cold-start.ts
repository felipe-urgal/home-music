import type { OfflineCollectionSummary, OfflineDownloadRecord } from './offline-downloads';
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

export function reconcileOfflineColdStartCollections(
  collections: readonly OfflineCollectionSummary[],
  records: readonly OfflineDownloadRecord[]
): OfflineCollectionSummary[] {
  const availableIds = new Set(records.map(record => record.track.id));

  return collections.map(collection => {
    const downloadedCount = collection.reference.trackIds.reduce(
      (count, trackId) => count + (availableIds.has(trackId) ? 1 : 0),
      0
    );

    let status = collection.status;
    if (collection.error && collection.downloadingCount === 0) status = 'error';
    else if (collection.status === 'paused') status = 'paused';
    else if (collection.status === 'downloading' || collection.downloadingCount > 0) status = 'downloading';
    else if (collection.totalCount > 0 && downloadedCount === collection.totalCount) status = 'available';
    else if (downloadedCount > 0) status = 'partial';
    else status = 'not-downloaded';

    return { ...collection, downloadedCount, status };
  });
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
