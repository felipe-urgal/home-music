import type { OfflineDownloadRecord } from './offline-downloads';
import { offlineAudioCacheName } from './offline-downloads';
import { readOfflineUserId } from './offline-user';

export function offlineCachedStreamUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

export async function filterOfflineRecordsWithBytes(
  records: readonly OfflineDownloadRecord[],
  hasBytes: (trackId: string) => Promise<boolean>
) {
  const checks = await Promise.all(records.map(async record => ({
    record,
    available: await hasBytes(record.track.id).catch(() => false)
  })));
  return checks.filter(item => item.available).map(item => item.record);
}

type OfflineColdStartOptions = {
  userId?: string | null;
  cacheStorage?: CacheStorage | null;
};

export async function readOfflineColdStartRecords(
  records: readonly OfflineDownloadRecord[],
  options: OfflineColdStartOptions = {}
) {
  const userId = options.userId === undefined ? readOfflineUserId() : options.userId;
  if (!userId || records.length === 0) return [];

  const cacheStorage = options.cacheStorage === undefined
    ? (typeof window !== 'undefined' && 'caches' in window ? window.caches : null)
    : options.cacheStorage;
  if (!cacheStorage) return [];

  try {
    const cache = await cacheStorage.open(offlineAudioCacheName(userId));
    return filterOfflineRecordsWithBytes(records, async trackId => {
      const response = await cache.match(offlineCachedStreamUrl(trackId));
      return Boolean(response);
    });
  } catch {
    return [];
  }
}
