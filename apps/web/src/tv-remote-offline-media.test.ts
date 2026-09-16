import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineAudioCacheName } from './offline-downloads';
import { OFFLINE_USER_ID_KEY } from './offline-user';
import { readTvRemoteOfflineMedia } from './tv-remote-offline-media';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key: string) { return values.get(key) ?? null; },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    removeItem(key: string) { values.delete(key); },
    setItem(key: string, value: string) { values.set(key, String(value)); }
  };
}

describe('tv remote offline media reader', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: createMemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens only the active user cache and reads the canonical cached stream request', async () => {
    window.localStorage.setItem(OFFLINE_USER_ID_KEY, 'user-7');
    const match = vi.fn().mockResolvedValue(new Response(new Blob(['audio-bytes'], { type: 'audio/mpeg' }), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' }
    }));
    const open = vi.fn().mockResolvedValue({ match });
    vi.stubGlobal('caches', { open });

    const media = await readTvRemoteOfflineMedia('track/a');

    expect(open).toHaveBeenCalledWith(offlineAudioCacheName('user-7'));
    expect(match).toHaveBeenCalledWith('/api/tracks/track%2Fa/stream');
    expect(media.trackId).toBe('track/a');
    expect(media.mimeType).toBe('audio/mpeg');
    expect(media.size).toBeGreaterThan(0);
    await expect(media.blob.text()).resolves.toBe('audio-bytes');
  });

  it('fails closed when identity, bytes or audio MIME are unavailable', async () => {
    vi.stubGlobal('caches', { open: vi.fn() });
    await expect(readTvRemoteOfflineMedia('track-1')).rejects.toThrow('Nenhum usuário offline');

    window.localStorage.setItem(OFFLINE_USER_ID_KEY, 'user-7');
    const match = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(new Response('html', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    }));
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match }) });
    await expect(readTvRemoteOfflineMedia('track-1')).rejects.toThrow('não está mais disponível');
    await expect(readTvRemoteOfflineMedia('track-1')).rejects.toThrow('formato de áudio válido');
  });
});
