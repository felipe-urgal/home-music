export const TV_LAN_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const TV_LAN_BRIDGE_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
export const TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS = 12_000;

export const TV_LAN_BRIDGE_OPERATIONS = [
  'challenge',
  'join',
  'signal-send',
  'signal-poll',
  'complete',
  'close',
] as const;

export type TvLanBridgeOperation = (typeof TV_LAN_BRIDGE_OPERATIONS)[number];
export type TvLanBridgeMessageSource = MessageEventSource | null;

export type TvLanBridgeReadyMessage = {
  version: typeof TV_LAN_BRIDGE_PROTOCOL_VERSION;
  type: 'ready';
  channelId: string;
};

export type TvLanBridgeRequestMessage = {
  version: typeof TV_LAN_BRIDGE_PROTOCOL_VERSION;
  type: 'request';
  channelId: string;
  requestId: string;
  operation: TvLanBridgeOperation;
  expiresAt: number;
  payload: unknown;
};

export type TvLanBridgeResponseMessage = {
  version: typeof TV_LAN_BRIDGE_PROTOCOL_VERSION;
  type: 'response';
  channelId: string;
  requestId: string;
  operation: TvLanBridgeOperation;
  expiresAt: number;
  ok: boolean;
  payload: unknown;
  error: string | null;
};

export type TvLanBridgeMessage =
  | TvLanBridgeReadyMessage
  | TvLanBridgeRequestMessage
  | TvLanBridgeResponseMessage;

const BRIDGE_ID_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const RESPONSE_ERROR_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const BRIDGE_OPERATIONS = new Set<string>(TV_LAN_BRIDGE_OPERATIONS);
const READY_KEYS = ['channelId', 'type', 'version'] as const;
const REQUEST_KEYS = ['channelId', 'expiresAt', 'operation', 'payload', 'requestId', 'type', 'version'] as const;
const RESPONSE_KEYS = ['channelId', 'error', 'expiresAt', 'ok', 'operation', 'payload', 'requestId', 'type', 'version'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && BRIDGE_ID_PATTERN.test(value);
}

function isValidOperation(value: unknown): value is TvLanBridgeOperation {
  return typeof value === 'string' && BRIDGE_OPERATIONS.has(value);
}

function isJsonValue(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    const valid = value.every(item => isJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return valid;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return false;
  }
  const valid = Object.values(value as Record<string, unknown>)
    .every(item => isJsonValue(item, seen, depth + 1));
  seen.delete(value);
  return valid;
}

function serializedByteLength(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isFreshExpiry(value: unknown, now: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > now;
}

export function createTvLanBridgeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createTvLanBridgeRequest(
  channelId: string,
  operation: TvLanBridgeOperation,
  payload: unknown,
  options: { now?: number; timeoutMs?: number; requestId?: string } = {},
): TvLanBridgeRequestMessage {
  const now = options.now ?? Date.now();
  const timeoutMs = options.timeoutMs ?? TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS;
  if (!isValidId(channelId)) throw new Error('channelId do bridge inválido.');
  if (!isValidOperation(operation)) throw new Error('Operação do bridge inválida.');
  if (!isJsonValue(payload)) throw new Error('Payload do bridge precisa ser JSON válido.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Timeout do bridge inválido.');
  const requestId = options.requestId ?? createTvLanBridgeId();
  if (!isValidId(requestId)) throw new Error('requestId do bridge inválido.');

  const request: TvLanBridgeRequestMessage = {
    version: TV_LAN_BRIDGE_PROTOCOL_VERSION,
    type: 'request',
    channelId,
    requestId,
    operation,
    expiresAt: now + timeoutMs,
    payload,
  };
  if (serializedByteLength(request) > TV_LAN_BRIDGE_MAX_MESSAGE_BYTES) {
    throw new Error('Payload do bridge excede o limite.');
  }
  return request;
}

export function parseTvLanBridgeMessage(value: unknown, now = Date.now()): TvLanBridgeMessage | null {
  if (!isRecord(value) || serializedByteLength(value) > TV_LAN_BRIDGE_MAX_MESSAGE_BYTES) return null;
  if (value.version !== TV_LAN_BRIDGE_PROTOCOL_VERSION || !isValidId(value.channelId)) return null;

  if (value.type === 'ready') {
    if (!hasExactKeys(value, READY_KEYS)) return null;
    return value as TvLanBridgeReadyMessage;
  }

  if (value.type === 'request') {
    if (!hasExactKeys(value, REQUEST_KEYS)) return null;
    if (!isValidId(value.requestId) || !isValidOperation(value.operation)) return null;
    if (!isFreshExpiry(value.expiresAt, now) || !isJsonValue(value.payload)) return null;
    return value as TvLanBridgeRequestMessage;
  }

  if (value.type === 'response') {
    if (!hasExactKeys(value, RESPONSE_KEYS)) return null;
    if (!isValidId(value.requestId) || !isValidOperation(value.operation)) return null;
    if (!isFreshExpiry(value.expiresAt, now) || typeof value.ok !== 'boolean' || !isJsonValue(value.payload)) return null;
    if (value.ok ? value.error !== null : typeof value.error !== 'string' || !RESPONSE_ERROR_PATTERN.test(value.error)) return null;
    return value as TvLanBridgeResponseMessage;
  }

  return null;
}

export function isExpectedTvLanBridgeEvent(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  expectedOrigin: string,
  expectedSource: TvLanBridgeMessageSource,
) {
  return event.origin === expectedOrigin && event.source === expectedSource;
}

export function isMatchingTvLanBridgeResponse(
  message: TvLanBridgeMessage,
  expected: { channelId: string; requestId: string; operation: TvLanBridgeOperation },
): message is TvLanBridgeResponseMessage {
  return message.type === 'response'
    && message.channelId === expected.channelId
    && message.requestId === expected.requestId
    && message.operation === expected.operation;
}
