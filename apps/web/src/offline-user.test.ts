import { describe, expect, it } from 'vitest';
import {
  OFFLINE_USER_ID_KEY,
  forgetOfflineUserId,
  isOfflineUserId,
  readOfflineUserId,
  rememberOfflineUserId
} from './offline-user';

const OFFLINE_PLAYER_STATE_KEY = 'home-music:offline-player:v1';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    }
  };
}

describe('offline user scope', () => {
  it('aceita ids opacos seguros para namespace local', () => {
    expect(isOfflineUserId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isOfflineUserId('user_A-01')).toBe(true);
    expect(isOfflineUserId('../outro')).toBe(false);
    expect(isOfflineUserId('')).toBe(false);
  });

  it('mantém estado do player somente enquanto a identidade offline é a mesma', () => {
    const storage = memoryStorage({ [OFFLINE_PLAYER_STATE_KEY]: '{"currentTrackId":"a"}' });

    expect(rememberOfflineUserId('user-a', storage)).toBe(true);
    expect(storage.getItem(OFFLINE_PLAYER_STATE_KEY)).toBeNull();

    storage.setItem(OFFLINE_PLAYER_STATE_KEY, '{"currentTrackId":"b"}');
    expect(rememberOfflineUserId('user-a', storage)).toBe(true);
    expect(storage.getItem(OFFLINE_PLAYER_STATE_KEY)).toContain('currentTrackId');

    expect(rememberOfflineUserId('user-b', storage)).toBe(true);
    expect(readOfflineUserId(storage)).toBe('user-b');
    expect(storage.getItem(OFFLINE_PLAYER_STATE_KEY)).toBeNull();
  });

  it('remove identidade e estado do player ao encerrar o escopo offline', () => {
    const storage = memoryStorage({
      [OFFLINE_USER_ID_KEY]: 'user-a',
      [OFFLINE_PLAYER_STATE_KEY]: '{"currentTrackId":"a"}'
    });

    forgetOfflineUserId(storage);
    expect(readOfflineUserId(storage)).toBeNull();
    expect(storage.getItem(OFFLINE_PLAYER_STATE_KEY)).toBeNull();
  });

  it('ignora valor legado ou corrompido em vez de criar um escopo inseguro', () => {
    const storage = memoryStorage({ [OFFLINE_USER_ID_KEY]: '../user-a' });
    expect(readOfflineUserId(storage)).toBeNull();
    expect(rememberOfflineUserId('../user-b', storage)).toBe(false);
    expect(readOfflineUserId(storage)).toBeNull();
  });
});
