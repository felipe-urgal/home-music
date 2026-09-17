import { describe, expect, it } from 'vitest';
import {
  TV_LAN_BRIDGE_MAX_MESSAGE_BYTES,
  TV_LAN_BRIDGE_PROTOCOL_VERSION,
  createTvLanBridgeRequest,
  isExpectedTvLanBridgeEvent,
  isMatchingTvLanBridgeResponse,
  parseTvLanBridgeMessage,
} from './tv-lan-bridge-protocol';

const channelId = 'channel-1234567890';
const requestId = 'request-1234567890';
const now = 1_000;

describe('tv lan bridge protocol', () => {
  it('aceita ready e request versionados com channelId/requestId válidos', () => {
    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'ready',
      channelId,
    }, now)).toEqual({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'ready',
      channelId,
    });

    const request = createTvLanBridgeRequest(channelId, 'challenge', { sessionId: 'session-1234567890' }, {
      now,
      timeoutMs: 500,
      requestId,
    });
    expect(parseTvLanBridgeMessage(request, now)).toEqual(request);
  });

  it('rejeita versão, operação, IDs e shapes desconhecidos', () => {
    expect(parseTvLanBridgeMessage({
      version: 2,
      type: 'ready',
      channelId,
    }, now)).toBeNull();
    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'request',
      channelId,
      requestId,
      operation: 'fetch-anything',
      expiresAt: now + 500,
      payload: null,
    }, now)).toBeNull();
    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'ready',
      channelId: 'short',
    }, now)).toBeNull();
    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'ready',
      channelId,
      unexpected: true,
    }, now)).toBeNull();
  });

  it('rejeita a operação temporária probe após a limpeza do spike', () => {
    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'request',
      channelId,
      requestId,
      operation: 'probe',
      expiresAt: now + 500,
      payload: null,
    }, now)).toBeNull();
  });

  it('rejeita payload acima do limite e requests expiradas', () => {
    const oversized = 'x'.repeat(TV_LAN_BRIDGE_MAX_MESSAGE_BYTES);
    expect(() => createTvLanBridgeRequest(channelId, 'signal-send', oversized, {
      now,
      timeoutMs: 500,
      requestId,
    })).toThrow('excede o limite');

    const expired = createTvLanBridgeRequest(channelId, 'signal-poll', null, {
      now,
      timeoutMs: 1,
      requestId,
    });
    expect(parseTvLanBridgeMessage(expired, now + 2)).toBeNull();
  });

  it('valida origin/source e correlação para descartar responses de outra tentativa', () => {
    const source = {} as MessageEventSource;
    expect(isExpectedTvLanBridgeEvent({ origin: 'http://tv.local:1234', source }, 'http://tv.local:1234', source)).toBe(true);
    expect(isExpectedTvLanBridgeEvent({ origin: 'http://outro.local:1234', source }, 'http://tv.local:1234', source)).toBe(false);
    expect(isExpectedTvLanBridgeEvent({ origin: 'http://tv.local:1234', source: null }, 'http://tv.local:1234', source)).toBe(false);

    const response = parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'response',
      channelId,
      requestId,
      operation: 'challenge',
      expiresAt: now + 500,
      ok: true,
      payload: { status: 200, body: {} },
      error: null,
    }, now);
    expect(response).not.toBeNull();
    if (!response) return;

    expect(isMatchingTvLanBridgeResponse(response, { channelId, requestId, operation: 'challenge' })).toBe(true);
    expect(isMatchingTvLanBridgeResponse(response, {
      channelId: 'channel-0987654321',
      requestId,
      operation: 'challenge',
    })).toBe(false);
    expect(isMatchingTvLanBridgeResponse(response, {
      channelId,
      requestId: 'request-0987654321',
      operation: 'challenge',
    })).toBe(false);
  });

  it('exige erro estruturado apenas em responses malsucedidas', () => {
    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'response',
      channelId,
      requestId,
      operation: 'join',
      expiresAt: now + 500,
      ok: false,
      payload: null,
      error: 'not_implemented',
    }, now)).not.toBeNull();

    expect(parseTvLanBridgeMessage({
      version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
      type: 'response',
      channelId,
      requestId,
      operation: 'join',
      expiresAt: now + 500,
      ok: true,
      payload: null,
      error: 'unexpected',
    }, now)).toBeNull();
  });
});
