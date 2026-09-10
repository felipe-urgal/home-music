import type { LyricsResponse } from '@home-music/shared';
import { apiFetch } from './api-client';
import { readOfflineUserId } from './offline-user';

const OFFLINE_LYRICS_PREFIX = 'home-music:offline-lyrics:v1:';

type OfflineLyricsSnapshot = {
  revision: string;
  lyrics: LyricsResponse | null;
  preparedAt: string;
};

type OfflineLyricsSnapshotMap = Record<string, OfflineLyricsSnapshot>;

export type PreparedOfflineLyricsSnapshot = {
  userId: string;
  trackId: string;
  snapshot: OfflineLyricsSnapshot;
};

function storageKey(userId: string) {
  return `${OFFLINE_LYRICS_PREFIX}${encodeURIComponent(userId)}`;
}

function contentRevision(lyrics: LyricsResponse | null) {
  const input = JSON.stringify(lyrics);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lyrics-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function isLyricsResponse(value: unknown): value is LyricsResponse {
  if (!value || typeof value !== 'object') return false;
  const lyrics = value as Partial<LyricsResponse>;
  return (
    (lyrics.source === 'lrc' || lyrics.source === 'txt') &&
    typeof lyrics.synchronized === 'boolean' &&
    Array.isArray(lyrics.lines) &&
    lyrics.lines.every(line => Boolean(
      line &&
      typeof line === 'object' &&
      ((line as { time?: unknown }).time === null || typeof (line as { time?: unknown }).time === 'number') &&
      typeof (line as { text?: unknown }).text === 'string'
    ))
  );
}

function parseSnapshots(raw: string | null): OfflineLyricsSnapshotMap {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: OfflineLyricsSnapshotMap = {};
    for (const [trackId, candidate] of Object.entries(value)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const snapshot = candidate as Partial<OfflineLyricsSnapshot>;
      if (
        typeof snapshot.revision !== 'string' ||
        typeof snapshot.preparedAt !== 'string' ||
        (snapshot.lyrics !== null && !isLyricsResponse(snapshot.lyrics))
      ) continue;
      result[trackId] = snapshot as OfflineLyricsSnapshot;
    }
    return result;
  } catch {
    return {};
  }
}

function readSnapshots(userId: string, storage: Pick<Storage, 'getItem'> = window.localStorage) {
  try {
    return parseSnapshots(storage.getItem(storageKey(userId)));
  } catch {
    return {};
  }
}

function writeSnapshots(
  userId: string,
  snapshots: OfflineLyricsSnapshotMap,
  storage: Pick<Storage, 'setItem'> = window.localStorage
) {
  storage.setItem(storageKey(userId), JSON.stringify(snapshots));
}

export async function prepareOfflineLyricsSnapshot(
  trackId: string,
  userId: string
): Promise<PreparedOfflineLyricsSnapshot | null> {
  try {
    const response = await apiFetch(`/api/tracks/${encodeURIComponent(trackId)}/lyrics`, {
      cache: 'no-store'
    });
    if (!response.ok) return null;
    const lyrics = await response.json() as LyricsResponse | null;
    if (lyrics !== null && !isLyricsResponse(lyrics)) return null;
    return {
      userId,
      trackId,
      snapshot: {
        revision: contentRevision(lyrics),
        lyrics,
        preparedAt: new Date().toISOString()
      }
    };
  } catch {
    // O áudio continua podendo ser preparado mesmo se lyrics estiver temporariamente indisponível.
    return null;
  }
}

export function commitOfflineLyricsSnapshot(
  prepared: PreparedOfflineLyricsSnapshot,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage
) {
  try {
    const current = readSnapshots(prepared.userId, storage);
    writeSnapshots(prepared.userId, { ...current, [prepared.trackId]: prepared.snapshot }, storage);
    return true;
  } catch {
    return false;
  }
}

export function readOfflineLyricsSnapshot(
  trackId: string,
  userId: string | null = readOfflineUserId(),
  storage: Pick<Storage, 'getItem'> = window.localStorage
) {
  if (!userId) return null;
  return readSnapshots(userId, storage)[trackId]?.lyrics ?? null;
}

export function deleteOfflineLyricsSnapshot(
  userId: string,
  trackId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage
) {
  try {
    const current = readSnapshots(userId, storage);
    if (!(trackId in current)) return;
    delete current[trackId];
    writeSnapshots(userId, current, storage);
  } catch {
    // Cache derivado: a próxima preparação/reconciliação pode reconstruí-lo.
  }
}

export function pruneOfflineLyricsSnapshots(
  userId: string,
  retainedTrackIds: ReadonlySet<string>,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage
) {
  try {
    const current = readSnapshots(userId, storage);
    const next = Object.fromEntries(Object.entries(current).filter(([trackId]) => retainedTrackIds.has(trackId)));
    if (Object.keys(next).length !== Object.keys(current).length) writeSnapshots(userId, next, storage);
  } catch {
    // Best-effort: o cache é derivado e nunca é autoridade da biblioteca.
  }
}

export const offlineLyricsCacheInternals = { contentRevision, parseSnapshots, storageKey };
