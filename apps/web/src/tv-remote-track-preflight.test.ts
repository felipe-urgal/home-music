import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTvRemoteCommand } from './tv-remote-client';
import { registerTvRemoteTrackPreflight } from './tv-remote-track-preflight';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TV remote play-track preflight', () => {
  it('waits for offline media preparation before publishing play-track', async () => {
    const order: string[] = [];
    const unregister = registerTvRemoteTrackPreflight('session-1', async trackId => {
      order.push(`prepare:${trackId}`);
    });
    const fetchMock = vi.fn(async () => {
      order.push('command');
      return new Response(null, { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendTvRemoteCommand('session-1', { type: 'play-track', trackId: 'track-1' });

    expect(order).toEqual(['prepare:track-1', 'command']);
    unregister();
  });

  it('does not prepare non-track commands and removes only the active registration', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerTvRemoteTrackPreflight('session-1', first);
    const unregisterSecond = registerTvRemoteTrackPreflight('session-1', second);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));

    unregisterFirst();
    await sendTvRemoteCommand('session-1', { type: 'next' });
    await sendTvRemoteCommand('session-1', { type: 'play-track', trackId: 'track-2' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('track-2');
    unregisterSecond();
  });

  it('does not publish play-track when media preparation fails', async () => {
    const unregister = registerTvRemoteTrackPreflight('session-2', async () => {
      throw new Error('Falha ao enviar a música para a TV.');
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTvRemoteCommand('session-2', { type: 'play-track', trackId: 'track-1' }))
      .rejects.toThrow('Falha ao enviar a música para a TV.');
    expect(fetchMock).not.toHaveBeenCalled();
    unregister();
  });
});
