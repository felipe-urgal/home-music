import { describe, expect, it, vi } from 'vitest';
import { TV_LAN_REMOTE_VERSION } from '@home-music/shared/tv-lan-remote';
import { createTvLanRemoteSignaling } from './tv-lan-remote-client';
import type { TvLanTransportFactory } from './tv-lan-transport';

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

function bridgeTransportMocks() {
  const challenge = vi.fn(async (_input: { sessionId: string; clientNonce: string }) => ({
    status: 200,
    body: {
      sessionId: SESSION_ID,
      clientNonce: CLIENT_NONCE,
      tvNonce: TV_NONCE,
      expiresAt: NOW + 30_000,
    },
  }));
  const join = vi.fn(async (_input: {
    sessionId: string;
    clientNonce: string;
    tvNonce: string;
    expiresAt: number;
    proof: string;
  }) => ({
    status: 200,
    body: { sessionToken: SESSION_TOKEN, expiresAt: NOW + 120_000 },
  }));
  const signalSend = vi.fn(async (_input: { authorization: string; body: string }) => ({ status: 202, body: {} }));
  const signalPoll = vi.fn(async (_input: { authorization: string; cursor: number }) => ({
    status: 200,
    body: { cursor: 0, messages: [] },
  }));
  const close = vi.fn(async (_input: { authorization: string }) => ({ status: 200, body: {} }));
  const finish = vi.fn();
  const dispose = vi.fn();
  const transportFactory: TvLanTransportFactory = vi.fn(async () => ({
    challenge,
    join,
    signalSend,
    signalPoll,
    close,
    finish,
    dispose,
  }));
  return { challenge, join, signalSend, signalPoll, close, finish, dispose, transportFactory };
}

describe('TV LAN remote client with bridge transport', () => {
  it('keeps proof/HMAC in the PWA and sends only semantic relay payloads', async () => {
    const { challenge, join, signalSend, close, transportFactory } = bridgeTransportMocks();

    const client = await createTvLanRemoteSignaling(qrText(), {
      transportFactory,
      createClientNonce: () => CLIENT_NONCE,
      createMessageId: () => 'message_1234567890abcdef',
      createRequestNonce: () => REQUEST_NONCE,
      now: () => NOW,
    });

    expect(challenge).toHaveBeenCalledWith({ sessionId: SESSION_ID, clientNonce: CLIENT_NONCE });
    expect(join).toHaveBeenCalledOnce();
    const joinPayload = join.mock.calls[0]?.[0];
    expect(joinPayload).toMatchObject({
      sessionId: SESSION_ID,
      clientNonce: CLIENT_NONCE,
      tvNonce: TV_NONCE,
      expiresAt: NOW + 30_000,
    });
    expect(joinPayload?.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(joinPayload).not.toHaveProperty('secret');

    await client.sendSignal({
      from: 'remote',
      type: 'description',
      description: { type: 'offer', sdp: 'v=0\r\n' },
    });

    expect(signalSend).toHaveBeenCalledOnce();
    const signalPayload = signalSend.mock.calls[0]?.[0];
    expect(signalPayload?.authorization).toMatch(new RegExp(`^HomeMusic ${SESSION_TOKEN}\\.${NOW}\\.${REQUEST_NONCE}\\.`));
    expect(JSON.parse(signalPayload?.body ?? '{}')).toEqual({
      messageId: 'message_1234567890abcdef',
      from: 'remote',
      signal: {
        from: 'remote',
        type: 'description',
        description: { type: 'offer', sdp: 'v=0\r\n' },
      },
    });
    expect(signalPayload).not.toHaveProperty('secret');

    client.close();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('finishes signaling after P2P without closing the LAN session or sending late ICE', async () => {
    const { signalSend, close, finish, dispose, transportFactory } = bridgeTransportMocks();
    const client = await createTvLanRemoteSignaling(qrText(), {
      transportFactory,
      createClientNonce: () => CLIENT_NONCE,
      createMessageId: () => 'message_1234567890abcdef',
      createRequestNonce: () => REQUEST_NONCE,
      now: () => NOW,
    });

    client.finish();
    expect(finish).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    await client.sendSignal({
      from: 'remote',
      type: 'ice-candidate',
      candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host' },
    });
    expect(signalSend).not.toHaveBeenCalled();

    client.close();
    expect(close).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
