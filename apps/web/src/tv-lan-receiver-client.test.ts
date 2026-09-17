import { describe, expect, it, vi } from 'vitest';
import { TV_LAN_REMOTE_VERSION } from '@home-music/shared/tv-lan-remote';
import { createTvLanReceiverSignaling, parseTvLanReceiverBootstrap } from './tv-lan-receiver-client';

function bootstrap(expiresAt = Date.now() + 60_000) {
  return {
    version: TV_LAN_REMOTE_VERSION,
    sessionId: 'session_1234567890abcdef',
    sessionToken: 'token_1234567890abcdef1234567890abcdef',
    expiresAt,
    signalingBase: 'http://127.0.0.1:43123'
  } as const;
}

describe('TV offline receiver LAN client', () => {
  it('accepts only current-version loopback bootstrap payloads', () => {
    const payload = bootstrap();
    expect(parseTvLanReceiverBootstrap(payload)).toEqual(payload);
    expect(parseTvLanReceiverBootstrap({ ...payload, signalingBase: 'http://192.168.1.2:43123' })).toBeNull();
    expect(parseTvLanReceiverBootstrap({ ...payload, version: 'old' })).toBeNull();
    expect(parseTvLanReceiverBootstrap(bootstrap(Date.now() - 1))).toBeNull();
  });

  it('publishes TV-role WebRTC signaling with the receiver token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/receiver/bootstrap') {
        return new Response(JSON.stringify(bootstrap()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } });
    });

    const client = await createTvLanReceiverSignaling({ fetchImpl: fetchImpl as typeof fetch, createMessageId: () => 'message_1234567890abcdef' });
    await client.sendSignal({
      from: 'tv',
      type: 'description',
      description: { type: 'answer', sdp: 'v=0\r\n' }
    });
    client.close();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('http://127.0.0.1:43123/signals?role=tv');
    expect(calls[1]?.init?.headers).toMatchObject({
      Authorization: `Bearer ${bootstrap().sessionToken}`,
      'Content-Type': 'application/json'
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      messageId: 'message_1234567890abcdef',
      from: 'tv',
      signal: { from: 'tv', type: 'description' }
    });
  });

  it('stops receiver signaling after P2P and ignores late ICE candidates', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/receiver/bootstrap') {
        return new Response(JSON.stringify(bootstrap()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } });
    });

    const client = await createTvLanReceiverSignaling({ fetchImpl: fetchImpl as typeof fetch });
    client.finish();
    await client.sendSignal({
      from: 'tv',
      type: 'ice-candidate',
      candidate: {
        candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0
      }
    });

    expect(calls).toHaveLength(1);
    client.close();
  });
});
