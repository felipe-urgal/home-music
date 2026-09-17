import { describe, expect, it, vi } from 'vitest';
import { TV_LAN_BRIDGE_PROTOCOL_VERSION } from './tv-lan-bridge-protocol';
import { createTvLanBridgeTransport } from './tv-lan-bridge-client';

const pairing = {
  version: 'home-music-lan-remote-v2' as const,
  host: '192.168.1.40',
  port: 43123,
  sessionId: 'session_1234567890abcdef',
  secret: '0123456789abcdef0123456789abcdef',
  expiresAt: Date.now() + 60_000,
};

type MessageListener = (event: MessageEvent) => void;

function fakeWindow() {
  const listeners = new Set<MessageListener>();
  let bridgeOrigin = '';
  let channelId = '';
  const popup = {
    closed: false,
    close: vi.fn(() => { popup.closed = true; }),
    postMessage: vi.fn((message: any) => {
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            origin: bridgeOrigin,
            source: popup,
            data: {
              version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
              type: 'response',
              channelId,
              requestId: message.requestId,
              operation: message.operation,
              expiresAt: message.expiresAt,
              ok: true,
              payload: { status: 200, body: { echoed: message.payload } },
              error: null,
            },
          } as unknown as MessageEvent);
        }
      });
    }),
  };

  const windowImpl = {
    location: { origin: 'https://music.example.com' },
    open: vi.fn((url: string) => {
      const parsed = new URL(url);
      bridgeOrigin = parsed.origin;
      channelId = parsed.searchParams.get('channelId') ?? '';
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            origin: bridgeOrigin,
            source: popup,
            data: {
              version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
              type: 'ready',
              channelId,
            },
          } as unknown as MessageEvent);
        }
      });
      return popup;
    }),
    addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener as unknown as MessageListener)),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener as unknown as MessageListener)),
    setTimeout: ((handler: TimerHandler, timeout?: number) => globalThis.setTimeout(handler, timeout)),
    clearTimeout: ((id: number) => globalThis.clearTimeout(id)),
  };

  return { windowImpl, popup, listeners };
}

describe('iOS LAN bridge client', () => {
  it('opens the local bridge and correlates semantic requests by requestId', async () => {
    const { windowImpl, popup } = fakeWindow();
    const transport = await createTvLanBridgeTransport(pairing, {
      windowImpl: windowImpl as unknown as Window,
      requestTimeoutMs: 1_000,
    });

    const response = await transport.challenge({
      sessionId: pairing.sessionId,
      clientNonce: 'client_1234567890abcdef',
    });

    expect(windowImpl.open).toHaveBeenCalledOnce();
    expect(String(windowImpl.open.mock.calls[0]?.[0])).toContain('/bridge?origin=https%3A%2F%2Fmusic.example.com&channelId=');
    expect(popup.postMessage).toHaveBeenCalledOnce();
    expect(response).toEqual({
      status: 200,
      body: {
        echoed: {
          sessionId: pairing.sessionId,
          clientNonce: 'client_1234567890abcdef',
        },
      },
    });

    const poll = await transport.signalPoll({
      authorization: 'HomeMusic token_1234567890abcdef.1800000000000.request_1234567890abcdef.signature',
      cursor: 7,
    });
    expect(poll.body).toEqual({
      echoed: {
        authorization: 'HomeMusic token_1234567890abcdef.1800000000000.request_1234567890abcdef.signature',
        cursor: 7,
      },
    });

    transport.dispose();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it('finishes the bridge after P2P setup and removes the message listener', async () => {
    const { windowImpl, popup, listeners } = fakeWindow();
    const transport = await createTvLanBridgeTransport(pairing, {
      windowImpl: windowImpl as unknown as Window,
      requestTimeoutMs: 1_000,
    });

    transport.finish?.();

    await vi.waitFor(() => expect(popup.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'complete', payload: null }),
      'http://192.168.1.40:43123'
    ));
    await vi.waitFor(() => expect(popup.close).toHaveBeenCalledOnce());
    expect(listeners.size).toBe(0);
  });

  it('fails with an actionable error when the popup is blocked', async () => {
    const windowImpl = {
      location: { origin: 'https://music.example.com' },
      open: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };

    await expect(createTvLanBridgeTransport(pairing, {
      windowImpl: windowImpl as unknown as Window,
    })).rejects.toThrow('bloqueou a abertura do bridge local');
  });

  it('times out a request that never receives a bridge response', async () => {
    const { windowImpl, popup } = fakeWindow();
    const transport = await createTvLanBridgeTransport(pairing, {
      windowImpl: windowImpl as unknown as Window,
      requestTimeoutMs: 1_000,
    });
    popup.postMessage.mockImplementation(() => undefined);

    await expect(transport.signalPoll({
      authorization: 'HomeMusic token_1234567890abcdef.1800000000000.request_1234567890abcdef.signature',
      cursor: 0,
    })).rejects.toThrow('não respondeu dentro do tempo esperado');

    transport.dispose();
  });

  it('aborts an in-flight request and removes the window listener', async () => {
    const controller = new AbortController();
    const { windowImpl, popup, listeners } = fakeWindow();
    const transport = await createTvLanBridgeTransport(pairing, {
      windowImpl: windowImpl as unknown as Window,
      requestTimeoutMs: 1_000,
      signal: controller.signal,
    });
    popup.postMessage.mockImplementation(() => undefined);

    const pending = transport.signalPoll({
      authorization: 'HomeMusic token_1234567890abcdef.1800000000000.request_1234567890abcdef.signature',
      cursor: 0,
    });
    controller.abort();

    await expect(pending).rejects.toThrow('cancelada');
    expect(listeners.size).toBe(0);
    expect(popup.close).toHaveBeenCalledOnce();
  });
});
