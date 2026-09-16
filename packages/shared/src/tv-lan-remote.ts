import { isTvRemoteSignal, type TvRemotePeerRole, type TvRemoteSignal } from './tv-remote.js';

export const TV_LAN_REMOTE_VERSION = 'home-music-lan-remote-v2' as const;
export const TV_LAN_PAIRING_TTL_MS = 2 * 60 * 1000;
export const TV_LAN_ESTABLISHED_TTL_MS = 30 * 60 * 1000;
export const TV_LAN_POLL_TIMEOUT_MS = 25 * 1000;
export const TV_LAN_MAX_PENDING_SIGNALS = 128;
export const TV_LAN_MAX_REQUEST_BYTES = 320 * 1024;
export const TV_LAN_MAX_MESSAGE_ID_LENGTH = 64;
export const TV_LAN_MAX_SESSION_TOKEN_LENGTH = 192;
export const TV_LAN_MIN_EPHEMERAL_TOKEN_LENGTH = 16;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export type TvLanQrPayload = {
  version: typeof TV_LAN_REMOTE_VERSION;
  host: string;
  port: number;
  sessionId: string;
  secret: string;
  expiresAt: number;
};

export type TvLanChallenge = {
  sessionId: string;
  clientNonce: string;
  tvNonce: string;
  expiresAt: number;
};

export type TvLanJoinRequest = TvLanChallenge & {
  proof: string;
};

export type TvLanJoinResponse = {
  sessionToken: string;
  expiresAt: number;
};

export type TvLanSignalEnvelope = {
  messageId: string;
  from: TvRemotePeerRole;
  signal: TvRemoteSignal;
};

export type TvLanSignalPoll = {
  cursor: number;
  messages: TvLanSignalEnvelope[];
};

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

export function isPrivateLanIpv4(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const octets = value.split('.');
  if (octets.length !== 4) return false;
  const parts = octets.map(part => Number(part));
  if (parts.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 || String(part) !== octets[index])) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function isTvLanEphemeralToken(value: unknown, maxLength = TV_LAN_MAX_SESSION_TOKEN_LENGTH): value is string {
  return typeof value === 'string'
    && value.length >= TV_LAN_MIN_EPHEMERAL_TOKEN_LENGTH
    && value.length <= maxLength
    && TOKEN_PATTERN.test(value);
}

export function isTvLanQrPayload(value: unknown, now = Date.now()): value is TvLanQrPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (!hasOnlyKeys(payload, ['version', 'host', 'port', 'sessionId', 'secret', 'expiresAt'])) return false;
  return payload.version === TV_LAN_REMOTE_VERSION
    && isPrivateLanIpv4(payload.host)
    && typeof payload.port === 'number'
    && Number.isInteger(payload.port)
    && payload.port >= 1024
    && payload.port <= 65_535
    && isTvLanEphemeralToken(payload.sessionId, 128)
    && isTvLanEphemeralToken(payload.secret, 128)
    && typeof payload.expiresAt === 'number'
    && Number.isSafeInteger(payload.expiresAt)
    && payload.expiresAt > now
    && payload.expiresAt <= now + TV_LAN_PAIRING_TTL_MS + 5_000;
}

export function createTvLanQrText(payload: TvLanQrPayload) {
  if (!isTvLanQrPayload(payload)) throw new Error('Payload de pareamento LAN inválido.');
  const url = new URL('home-music://tv-lan');
  url.searchParams.set('version', payload.version);
  url.searchParams.set('host', payload.host);
  url.searchParams.set('port', String(payload.port));
  url.searchParams.set('session', payload.sessionId);
  url.searchParams.set('secret', payload.secret);
  url.searchParams.set('expires', String(payload.expiresAt));
  return url.toString();
}

export function parseTvLanQrText(raw: string, now = Date.now()): TvLanQrPayload | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'home-music:' || url.hostname !== 'tv-lan' || url.pathname !== '') return null;
    const payload = {
      version: url.searchParams.get('version'),
      host: url.searchParams.get('host'),
      port: Number(url.searchParams.get('port')),
      sessionId: url.searchParams.get('session'),
      secret: url.searchParams.get('secret'),
      expiresAt: Number(url.searchParams.get('expires'))
    };
    if (Array.from(url.searchParams.keys()).some(key => !['version', 'host', 'port', 'session', 'secret', 'expires'].includes(key))) return null;
    return isTvLanQrPayload(payload, now) ? payload : null;
  } catch {
    return null;
  }
}

export function tvLanProofMessage(challenge: TvLanChallenge) {
  if (!isTvLanEphemeralToken(challenge.sessionId, 128)
    || !isTvLanEphemeralToken(challenge.clientNonce, 128)
    || !isTvLanEphemeralToken(challenge.tvNonce, 128)
    || !Number.isSafeInteger(challenge.expiresAt)) {
    throw new Error('Challenge LAN inválido.');
  }
  return `${TV_LAN_REMOTE_VERSION}\n${challenge.sessionId}\n${challenge.clientNonce}\n${challenge.tvNonce}\n${challenge.expiresAt}`;
}

export function tvLanRequestKeyMessage(challenge: TvLanChallenge, session: TvLanJoinResponse) {
  tvLanProofMessage(challenge);
  if (!isTvLanEphemeralToken(session.sessionToken)
    || !Number.isSafeInteger(session.expiresAt)) {
    throw new Error('Sessão LAN inválida.');
  }
  return `${TV_LAN_REMOTE_VERSION}\nrequest-key\n${challenge.sessionId}\n${challenge.clientNonce}\n${challenge.tvNonce}\n${challenge.expiresAt}\n${session.sessionToken}\n${session.expiresAt}`;
}

export function isTvLanSignalEnvelope(value: unknown): value is TvLanSignalEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  if (!hasOnlyKeys(envelope, ['messageId', 'from', 'signal'])) return false;
  if (!isTvLanEphemeralToken(envelope.messageId, TV_LAN_MAX_MESSAGE_ID_LENGTH)) return false;
  if (envelope.from !== 'tv' && envelope.from !== 'remote') return false;
  if (!isTvRemoteSignal(envelope.signal)) return false;
  return envelope.signal.from === envelope.from;
}

export class TvLanReplayGuard {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = TV_LAN_MAX_PENDING_SIGNALS * 2) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Capacidade de replay inválida.');
  }

  accept(messageId: string) {
    if (!isTvLanEphemeralToken(messageId, TV_LAN_MAX_MESSAGE_ID_LENGTH) || this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    this.order.push(messageId);
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest) this.seen.delete(oldest);
    }
    return true;
  }

  clear() {
    this.seen.clear();
    this.order.length = 0;
  }
}
