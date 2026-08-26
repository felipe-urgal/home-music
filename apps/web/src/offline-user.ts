export const OFFLINE_USER_ID_KEY = 'home-music:offline-user-id:v1';
const LEGACY_OFFLINE_PLAYER_STATE_KEY = 'home-music:offline-player:v1';

const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isOfflineUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID_RE.test(value);
}

export function readOfflineUserId(storage: StorageLike | null = browserStorage()) {
  if (!storage) return null;
  try {
    const value = storage.getItem(OFFLINE_USER_ID_KEY);
    return isOfflineUserId(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberOfflineUserId(userId: string, storage: StorageLike | null = browserStorage()) {
  if (!storage || !isOfflineUserId(userId)) return false;
  try {
    const previousUserId = readOfflineUserId(storage);
    storage.setItem(OFFLINE_USER_ID_KEY, userId);
    if (previousUserId !== userId) storage.removeItem(LEGACY_OFFLINE_PLAYER_STATE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function forgetOfflineUserId(storage: StorageLike | null = browserStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(OFFLINE_USER_ID_KEY);
    storage.removeItem(LEGACY_OFFLINE_PLAYER_STATE_KEY);
  } catch {
    // O modo offline é best-effort; falhas de storage não alteram a sessão do servidor.
  }
}
