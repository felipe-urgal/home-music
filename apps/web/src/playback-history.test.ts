import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYLISTS_CHANGED_EVENT } from './library-events';
import { recordCompletedPlayback, trackIdFromPlaybackUrl } from './playback-history';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('playback history', () => {
  it('extrai somente IDs de URLs reais de stream/transcode', () => {
    expect(trackIdFromPlaybackUrl('/api/tracks/abc123/stream')).toBe('abc123');
    expect(trackIdFromPlaybackUrl('https://music.test/api/tracks/faixa%20um/transcode?quality=auto')).toBe('faixa um');
    expect(trackIdFromPlaybackUrl('blob:https://music.test/123')).toBeNull();
    expect(trackIdFromPlaybackUrl('/api/tracks/abc123/cover')).toBeNull();
  });

  it('registra conclusão com proteção de mutação e invalida playlists após sucesso', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(recordCompletedPlayback('faixa um')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/history/faixa%20um');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-Home-Music-Request')).toBe('1');
    expect(init.credentials).toBe('same-origin');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as Event).type).toBe(PLAYLISTS_CHANGED_EVENT);
  });

  it('não invalida playlists quando o backend rejeita o registro', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(recordCompletedPlayback('inexistente')).resolves.toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
