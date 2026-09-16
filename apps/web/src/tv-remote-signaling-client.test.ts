import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TvRemoteSignal } from '@home-music/shared/tv-remote';
import { openTvRemoteEvents, sendTvRemoteSignal } from './tv-remote-client';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback = typeof listener === 'function'
      ? listener as (event: MessageEvent<string>) => void
      : (event: MessageEvent<string>) => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  close() { this.closed = true; }

  emit(type: string, data: unknown, lastEventId: string) {
    const event = { data: JSON.stringify(data), lastEventId } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const offer: TvRemoteSignal = {
  from: 'remote',
  type: 'description',
  description: { type: 'offer', sdp: 'v=0\r\n' }
};

describe('tv remote WebRTC signaling client', () => {
  it('sends signaling through the authenticated mutation endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendTvRemoteSignal('a/b', offer);

    expect(fetchMock).toHaveBeenCalledWith('/api/tv-remote/sessions/a%2Fb/signals', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify(offer)
    }));
  });

  it('delivers only valid signaling events and keeps session event ordering', () => {
    const received: TvRemoteSignal[] = [];
    const stop = openTvRemoteEvents('session', { onSignal: signal => received.push(signal) });
    const source = FakeEventSource.instances[0]!;

    source.emit('signal', offer, '1');
    source.emit('signal', { ...offer, from: 'invalid' }, '2');
    source.emit('signal', {
      from: 'tv',
      type: 'ice-candidate',
      candidate: { candidate: 'candidate:1', sdpMid: null, sdpMLineIndex: 0 }
    }, '3');

    expect(received).toEqual([
      offer,
      {
        from: 'tv',
        type: 'ice-candidate',
        candidate: { candidate: 'candidate:1', sdpMid: null, sdpMLineIndex: 0 }
      }
    ]);
    stop();
  });
});
