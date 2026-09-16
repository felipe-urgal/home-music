import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TV_LAN_PAIRING_TTL_MS,
  TV_LAN_REMOTE_VERSION,
  TvLanReplayGuard,
  createTvLanQrText,
  isPrivateLanIpv4,
  isTvLanQrPayload,
  isTvLanSignalEnvelope,
  parseTvLanQrText,
  tvLanProofMessage
} from '@home-music/shared/tv-lan-remote';

const now = 1_800_000_000_000;
const payload = {
  version: TV_LAN_REMOTE_VERSION,
  host: '192.168.1.40',
  port: 43123,
  sessionId: 'session_1234567890abcdef',
  secret: 'secret_1234567890abcdef1234567890abcdef',
  expiresAt: now + 60_000
} as const;

test('offline LAN QR payload round-trips without account credentials', () => {
  assert.equal(isTvLanQrPayload(payload, now), true);
  const encoded = createTvLanQrText({ ...payload, expiresAt: Date.now() + 60_000 });
  assert.equal(encoded.includes('username='), false);
  assert.equal(encoded.includes('token='), false);
  const parsed = parseTvLanQrText(encoded);
  assert.deepEqual(parsed, { ...payload, expiresAt: parsed?.expiresAt });
  assert.equal(parsed?.host, payload.host);
  assert.equal(parsed?.sessionId, payload.sessionId);
  assert.equal(parsed?.secret, payload.secret);
});

test('offline LAN QR accepts only private IPv4 and a short-lived pairing window', () => {
  assert.equal(isPrivateLanIpv4('10.0.0.4'), true);
  assert.equal(isPrivateLanIpv4('172.16.0.4'), true);
  assert.equal(isPrivateLanIpv4('172.31.255.4'), true);
  assert.equal(isPrivateLanIpv4('192.168.100.4'), true);
  assert.equal(isPrivateLanIpv4('172.32.0.4'), false);
  assert.equal(isPrivateLanIpv4('8.8.8.8'), false);
  assert.equal(isPrivateLanIpv4('192.168.01.4'), false);

  assert.equal(isTvLanQrPayload({ ...payload, host: '8.8.8.8' }, now), false);
  assert.equal(isTvLanQrPayload({ ...payload, expiresAt: now - 1 }, now), false);
  assert.equal(isTvLanQrPayload({ ...payload, expiresAt: now + TV_LAN_PAIRING_TTL_MS + 10_000 }, now), false);
  assert.equal(isTvLanQrPayload({ ...payload, username: 'admin' }, now), false);
});

test('proof input is deterministic and binds both nonces, session and expiry', () => {
  assert.equal(
    tvLanProofMessage({
      sessionId: payload.sessionId,
      clientNonce: 'client_nonce_1234567890',
      tvNonce: 'tv_nonce_12345678901234',
      expiresAt: payload.expiresAt
    }),
    `${TV_LAN_REMOTE_VERSION}\n${payload.sessionId}\nclient_nonce_1234567890\ntv_nonce_12345678901234\n${payload.expiresAt}`
  );
});

test('signal envelopes require role consistency and the existing WebRTC signal limits', () => {
  const envelope = {
    messageId: 'message_1234567890abcdef',
    from: 'remote',
    signal: {
      from: 'remote',
      type: 'description',
      description: { type: 'offer', sdp: 'v=0\r\n' }
    }
  } as const;
  assert.equal(isTvLanSignalEnvelope(envelope), true);
  assert.equal(isTvLanSignalEnvelope({ ...envelope, from: 'tv' }), false);
  assert.equal(isTvLanSignalEnvelope({
    ...envelope,
    signal: { ...envelope.signal, description: { type: 'offer', sdp: 'x'.repeat(256 * 1024 + 1) } }
  }), false);
});

test('replay guard rejects duplicate message ids and has bounded memory', () => {
  const guard = new TvLanReplayGuard(2);
  const first = 'message_aaaaaaaaaaaaaaaa';
  const second = 'message_bbbbbbbbbbbbbbbb';
  const third = 'message_cccccccccccccccc';
  assert.equal(guard.accept(first), true);
  assert.equal(guard.accept(first), false);
  assert.equal(guard.accept(second), true);
  assert.equal(guard.accept(third), true);
  assert.equal(guard.accept(first), true);
  guard.clear();
  assert.equal(guard.accept(third), true);
});
