import { describe, expect, it, vi } from 'vitest';
import {
  TV_LAN_REMOTE_VERSION,
  type TvLanChallenge
} from '@home-music/shared/tv-lan-remote';
import {
  computeTvLanJoinProof,
  computeTvLanRequestAuthorization,
  createTvLanRemoteSignaling,
  tvLanRequestErrorMessage
} from './tv-lan-remote-client';

const NOW = 1_800_000_000_000;
const SESSION_ID = 'session_1234567890abcdef';
const CLIENT_NONCE = 'client_1234567890abcdef';
const TV_NONCE = 'tvnonce_1234567890abcdef';
const SECRET = '0123456789abcdef0123456789abcdef';
const SESSION_TOKEN = 'token_1234567890abcdef1234567890abcdef';
const REQUEST_NONCE = 'request_1234567890abcdef';

function qrText() {
  return `home-music://tv-lan?version=${TV_LAN_REMOTE_VERSION}&host=192.168.1.40&port=43123&session=${SESSION_ID}&secret=${SECRET}&expires=${NOW + 60_000}`;
}

function challenge(expiresAt = NOW + 30_000): TvLanChallenge {
  return {
    sessionId: SESSION_ID,
    clientNonce: CLIENT_NONCE,
    tvNonce: TV_NONCE,
    expiresAt
  };
}

describe('TV LAN remote client', () => {
  it('computes the Android-compatible HMAC proof', async () => {
    const value = await computeTvLanJoinProof(SECRET, {
      sessionId: SESSION_ID,
      clientNonce: CLIENT_NONCE,
      tvNonce: TV_NONCE,
      expiresAt: 2_000_000_000_000
    });

    expect(value).toBe('ZEGvvLn30JrMOqlhtv8H0Wa7W5ShpFH1pDBK9ZJOwoQ');
  });

  it('computes the Android-compatible per-request authorization', async () => {
    const body = JSON.stringify({
      messageId: 'message_1234567890abcdef',
      from: 'remote',
      signal: {
        from: 'remote',
        type: 'description',
        description: { type: 'offer', sdp: 'v=0\r\n' }
      }
    });

    const authorization = await computeTvLanRequestAuthorization({
      secret: SECRET,
      challenge: challenge(),
      session: { sessionToken: SESSION_TOKEN, expiresAt: NOW + 120_000 },
      method: 'POST',
      target: '/signals?role=remote',
      body,
      timestamp: NOW,
      nonce: REQUEST_NONCE
    });

    expect(authorization).toBe(
      `HomeMusic ${SESSION_TOKEN}.${NOW}.${REQUEST_NONCE}.I8zKt0Vy5QC006hebmXRWDRLMiVZmzf8xhibdqTxSGY`
    );
  });

  it('classifies denied local-network access separately from an unreachable TV', () => {
    expect(tvLanRequestErrorMessage(new DOMException('denied', 'NotAllowedError'), 'denied'))
      .toContain('acesso à rede local foi negado');
    expect(tvLanRequestErrorMessage(new TypeError('Failed to fetch'), 'prompt'))
      .toContain('Não foi possível alcançar a TV');
  });

  it('pairs with challenge/join and accepts a no-content signal acknowledgement', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/challenge?')) {
        return new Response(JSON.stringify(challenge()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/join')) {
        return new Response(JSON.stringify({ sessionToken: SESSION_TOKEN, expiresAt: NOW + 120_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.endsWith('/signals?role=remote')) {
        return new Response(null, { status: 204 });
      }
      return new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } });
    });

    const client = await createTvLanRemoteSignaling(qrText(), {
      fetchImpl: fetchImpl as typeof fetch,
      createClientNonce: () => CLIENT_NONCE,
      createMessageId: () => 'message_1234567890abcdef',
      createRequestNonce: () => REQUEST_NONCE,
      now: () => NOW
    });

    await client.sendSignal({
      from: 'remote',
      type: 'description',
      description: { type: 'offer', sdp: 'v=0\r\n' }
    });

    expect(calls[0]?.url).toBe(`http://192.168.1.40:43123/challenge?session=${SESSION_ID}&clientNonce=${CLIENT_NONCE}`);
    expect(calls[1]?.url).toBe('http://192.168.1.40:43123/join');
    const joinBody = JSON.parse(String(calls[1]?.init?.body));
    expect(joinBody).toMatchObject(challenge());
    expect(joinBody.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(calls[2]?.url).toBe('http://192.168.1.40:43123/signals?role=remote');
    expect(calls[2]?.init?.headers).toMatchObject({
      Authorization: `HomeMusic ${SESSION_TOKEN}.${NOW}.${REQUEST_NONCE}.I8zKt0Vy5QC006hebmXRWDRLMiVZmzf8xhibdqTxSGY`,
      'Content-Type': 'application/json'
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      messageId: 'message_1234567890abcdef',
      from: 'remote',
      signal: {
        from: 'remote',
        type: 'description',
        description: { type: 'offer', sdp: 'v=0\r\n' }
      }
    });
    client.close();
  });

  it('cancels challenge/join work when the UI closes the pending connection', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));

    const pending = createTvLanRemoteSignaling(qrText(), {
      fetchImpl: fetchImpl as typeof fetch,
      createClientNonce: () => CLIENT_NONCE,
      now: () => NOW,
      signal: controller.signal
    });
    controller.abort();

    await expect(pending).rejects.toThrow('Conexão LAN cancelada.');
  });

  it('polls TV signaling with the authenticated cursor and stops cleanly', async () => {
    let pollCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/challenge?')) {
        return new Response(JSON.stringify(challenge()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/join')) {
        return new Response(JSON.stringify({ sessionToken: SESSION_TOKEN, expiresAt: NOW + 120_000 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/signals?role=remote&cursor=')) {
        pollCount += 1;
        return new Response(JSON.stringify({
          cursor: 4,
          messages: [{
            messageId: 'message_tv_1234567890abcdef',
            from: 'tv',
            signal: {
              from: 'tv',
              type: 'description',
              description: { type: 'answer', sdp: 'v=0\r\n' }
            }
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/close?role=remote')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } });
    });

    const client = await createTvLanRemoteSignaling(qrText(), {
      fetchImpl: fetchImpl as typeof fetch,
      createClientNonce: () => CLIENT_NONCE,
      now: () => NOW,
      pollDelayMs: 100
    });

    const received = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('signal timeout')), 1_000);
      client.start(signal => {
        clearTimeout(timeout);
        client.close();
        resolve(signal.type);
      }, reject);
    });

    expect(received).toBe('description');
    expect(pollCount).toBe(1);
  });

  it('rejects an expired or malformed QR before making LAN requests', async () => {
    const fetchImpl = vi.fn();
    await expect(createTvLanRemoteSignaling('home-music://tv-lan?version=old', {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW
    })).rejects.toThrow('QR de pareamento inválido ou expirado.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
