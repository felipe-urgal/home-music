import { describe, expect, it, vi } from 'vitest';
import type { TvRemoteSignal } from '@home-music/shared/tv-remote';
import type { TvRemoteEventHandlers } from './tv-remote-client';
import {
  createServerTvRemoteSessionTransport,
  wrapLanTvRemoteSessionTransport
} from './tv-remote-session-transport';

const signal: TvRemoteSignal = {
  from: 'remote',
  type: 'description',
  description: { type: 'offer', sdp: 'v=0' }
};

describe('TV remote session transport facade', () => {
  it('adapts server SSE/REST signaling behind one interface', async () => {
    let handlers: TvRemoteEventHandlers | undefined;
    const stop = vi.fn();
    const sendSignal = vi.fn(async () => undefined);
    const transport = createServerTvRemoteSessionTransport('session-1', {
      sendSignal,
      openEvents: (_id, next) => { handlers = next; return stop; }
    });
    const received: TvRemoteSignal[] = [];

    const unsubscribe = transport.subscribeSignals(value => { received.push(value); });
    handlers?.onSignal?.(signal, 1);
    await transport.sendSignal(signal);

    expect(transport.mode).toBe('server');
    expect(received).toEqual([signal]);
    expect(sendSignal).toHaveBeenCalledWith('session-1', signal);
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('adapts LAN polling without exposing HTTP details to the peer', async () => {
    let onSignal: ((value: TvRemoteSignal) => void | Promise<void>) | null = null;
    const signaling = {
      sendSignal: vi.fn(async () => undefined),
      start: vi.fn((listener: (value: TvRemoteSignal) => void | Promise<void>) => { onSignal = listener; }),
      close: vi.fn()
    };
    const transport = wrapLanTvRemoteSessionTransport(signaling);
    const received: TvRemoteSignal[] = [];

    transport.subscribeSignals(value => { received.push(value); });
    const listener = onSignal as ((value: TvRemoteSignal) => void | Promise<void>) | null;
    if (listener) await listener(signal);
    await transport.sendSignal(signal);
    transport.close();

    expect(transport.mode).toBe('lan');
    expect(received).toEqual([signal]);
    expect(signaling.sendSignal).toHaveBeenCalledWith(signal);
    expect(signaling.close).toHaveBeenCalledOnce();
  });
});
