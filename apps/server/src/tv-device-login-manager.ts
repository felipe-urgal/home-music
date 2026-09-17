import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const TV_DEVICE_LOGIN_TTL_MS = 5 * 60 * 1000;
export const TV_DEVICE_LOGIN_TERMINAL_RETENTION_MS = 60 * 1000;
export const TV_DEVICE_LOGIN_MAX_ACTIVE_REQUESTS = 64;
export const TV_DEVICE_LOGIN_MAX_ACTIVE_PER_ORIGIN = 4;
export const TV_DEVICE_LOGIN_START_RATE_LIMIT_MAX = 8;
export const TV_DEVICE_LOGIN_START_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const TV_DEVICE_LOGIN_MAX_RATE_LIMIT_ENTRIES = 512;

const REQUEST_ID_BYTES = 18;
const SECRET_BYTES = 32;
const MAX_OPAQUE_TOKEN_LENGTH = 128;
const MAX_USER_ID_LENGTH = 128;
const RATE_LIMIT_OVERFLOW_KEY = '__overflow__';

export type TvDeviceLoginState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
type InternalState = TvDeviceLoginState | 'consuming';

export type TvDeviceLoginStart = Readonly<{
  requestId: string;
  deviceToken: string;
  approvalToken: string;
  displayCode: string;
  expiresAt: number;
}>;

export type TvDeviceLoginApproval = Readonly<{
  displayCode: string;
}>;

export type TvDeviceLoginConsumeLease = Readonly<{
  userId: string;
  commit: () => void;
  rollback: () => void;
}>;

export type TvDeviceLoginConsumeResult =
  | { ok: true; lease: TvDeviceLoginConsumeLease }
  | { ok: false; reason: 'invalid' | 'pending' | 'denied' | 'expired' | 'consumed' | 'busy' };

type DeviceLoginRequest = {
  requestId: string;
  deviceTokenHash: Buffer;
  approvalTokenHash: Buffer;
  displayCode: string;
  state: InternalState;
  approvedUserId: string | null;
  originKey: string;
  createdAt: number;
  expiresAt: number;
  terminalAt: number | null;
};

type StartRateLimitEntry = {
  count: number;
  resetAt: number;
};

type TvDeviceLoginManagerOptions = {
  now?: () => number;
  randomToken?: (bytes: number) => string;
  randomCode?: () => string;
  ttlMs?: number;
  terminalRetentionMs?: number;
  maxActiveRequests?: number;
  maxActivePerOrigin?: number;
  startRateLimitMax?: number;
  startRateLimitWindowMs?: number;
  maxRateLimitEntries?: number;
};

export class TvDeviceLoginRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Limite de criação de login da TV atingido.');
    this.name = 'TvDeviceLoginRateLimitError';
  }
}

export class TvDeviceLoginCapacityError extends Error {
  constructor(
    readonly scope: 'global' | 'origin',
    readonly retryAfterSeconds: number
  ) {
    super('Capacidade de solicitações de login da TV atingida.');
    this.name = 'TvDeviceLoginCapacityError';
  }
}

function defaultRandomToken(bytes: number) {
  return randomBytes(bytes).toString('base64url');
}

function defaultRandomCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function hashSecret(value: string) {
  return createHash('sha256').update(value).digest();
}

function secretMatches(expectedHash: Buffer, value: string) {
  const candidate = hashSecret(value);
  return timingSafeEqual(expectedHash, candidate);
}

function validOpaqueToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= MAX_OPAQUE_TOKEN_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function activeState(state: InternalState) {
  return state === 'pending' || state === 'approved' || state === 'consuming';
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${label} inválido.`);
  return value;
}

export class TvDeviceLoginManager {
  private readonly requests = new Map<string, DeviceLoginRequest>();
  private readonly startRateLimits = new Map<string, StartRateLimitEntry>();
  private readonly now: () => number;
  private readonly randomToken: (bytes: number) => string;
  private readonly randomCode: () => string;
  private readonly ttlMs: number;
  private readonly terminalRetentionMs: number;
  private readonly maxActiveRequests: number;
  private readonly maxActivePerOrigin: number;
  private readonly startRateLimitMax: number;
  private readonly startRateLimitWindowMs: number;
  private readonly maxRateLimitEntries: number;

  constructor(options: TvDeviceLoginManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? defaultRandomToken;
    this.randomCode = options.randomCode ?? defaultRandomCode;
    this.ttlMs = positiveInteger(options.ttlMs ?? TV_DEVICE_LOGIN_TTL_MS, 'TTL');
    this.terminalRetentionMs = positiveInteger(
      options.terminalRetentionMs ?? TV_DEVICE_LOGIN_TERMINAL_RETENTION_MS,
      'Retenção terminal'
    );
    this.maxActiveRequests = positiveInteger(
      options.maxActiveRequests ?? TV_DEVICE_LOGIN_MAX_ACTIVE_REQUESTS,
      'Capacidade global'
    );
    this.maxActivePerOrigin = positiveInteger(
      options.maxActivePerOrigin ?? TV_DEVICE_LOGIN_MAX_ACTIVE_PER_ORIGIN,
      'Capacidade por origem'
    );
    this.startRateLimitMax = positiveInteger(
      options.startRateLimitMax ?? TV_DEVICE_LOGIN_START_RATE_LIMIT_MAX,
      'Rate limit'
    );
    this.startRateLimitWindowMs = positiveInteger(
      options.startRateLimitWindowMs ?? TV_DEVICE_LOGIN_START_RATE_LIMIT_WINDOW_MS,
      'Janela do rate limit'
    );
    this.maxRateLimitEntries = positiveInteger(
      options.maxRateLimitEntries ?? TV_DEVICE_LOGIN_MAX_RATE_LIMIT_ENTRIES,
      'Capacidade do rate limit'
    );
  }

  start(originKey: string): TvDeviceLoginStart {
    const now = this.now();
    this.cleanupInternal(now);
    this.recordStartAttempt(originKey, now);

    const active = [...this.requests.values()].filter(request => activeState(request.state));
    if (active.length >= this.maxActiveRequests) {
      throw new TvDeviceLoginCapacityError(
        'global',
        this.retryAfterFor(active, now)
      );
    }

    const fromOrigin = active.filter(request => request.originKey === originKey);
    if (fromOrigin.length >= this.maxActivePerOrigin) {
      throw new TvDeviceLoginCapacityError(
        'origin',
        this.retryAfterFor(fromOrigin, now)
      );
    }

    let requestId = '';
    do {
      requestId = this.randomToken(REQUEST_ID_BYTES);
    } while (this.requests.has(requestId));

    const deviceToken = this.randomToken(SECRET_BYTES);
    let approvalToken = this.randomToken(SECRET_BYTES);
    while (approvalToken === deviceToken) approvalToken = this.randomToken(SECRET_BYTES);

    const request: DeviceLoginRequest = {
      requestId,
      deviceTokenHash: hashSecret(deviceToken),
      approvalTokenHash: hashSecret(approvalToken),
      displayCode: this.randomCode(),
      state: 'pending',
      approvedUserId: null,
      originKey,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      terminalAt: null
    };
    this.requests.set(requestId, request);

    return Object.freeze({
      requestId,
      deviceToken,
      approvalToken,
      displayCode: request.displayCode,
      expiresAt: request.expiresAt
    });
  }

  status(requestId: unknown, deviceToken: unknown): TvDeviceLoginState | null {
    const request = this.resolveDeviceRequest(requestId, deviceToken);
    if (!request) return null;
    return request.state === 'consuming' ? 'approved' : request.state;
  }

  preview(approvalToken: unknown): TvDeviceLoginApproval | null {
    const request = this.resolveApprovalRequest(approvalToken);
    if (!request || request.state !== 'pending') return null;
    return Object.freeze({ displayCode: request.displayCode });
  }

  approve(approvalToken: unknown, userId: string): TvDeviceLoginApproval | null {
    if (!userId || userId.length > MAX_USER_ID_LENGTH) return null;
    const request = this.resolveApprovalRequest(approvalToken);
    if (!request || request.state !== 'pending') return null;

    request.state = 'approved';
    request.approvedUserId = userId;
    return Object.freeze({ displayCode: request.displayCode });
  }

  deny(approvalToken: unknown) {
    const request = this.resolveApprovalRequest(approvalToken);
    if (!request || request.state !== 'pending') return false;

    request.state = 'denied';
    request.approvedUserId = null;
    request.terminalAt = this.now();
    return true;
  }

  reserveConsume(requestId: unknown, deviceToken: unknown): TvDeviceLoginConsumeResult {
    const request = this.resolveDeviceRequest(requestId, deviceToken);
    if (!request) return { ok: false, reason: 'invalid' };

    switch (request.state) {
      case 'pending':
      case 'denied':
      case 'expired':
      case 'consumed':
        return { ok: false, reason: request.state };
      case 'consuming':
        return { ok: false, reason: 'busy' };
      case 'approved':
        break;
    }

    if (!request.approvedUserId) return { ok: false, reason: 'invalid' };
    request.state = 'consuming';
    const userId = request.approvedUserId;
    let settled = false;

    const commit = () => {
      if (settled) return;
      settled = true;
      const current = this.requests.get(request.requestId);
      if (!current || current !== request || current.state !== 'consuming') return;
      current.state = 'consumed';
      current.approvedUserId = null;
      current.terminalAt = this.now();
    };

    const rollback = () => {
      if (settled) return;
      settled = true;
      const current = this.requests.get(request.requestId);
      if (!current || current !== request || current.state !== 'consuming') return;
      current.state = 'approved';
    };

    return {
      ok: true,
      lease: Object.freeze({ userId, commit, rollback })
    };
  }

  cancel(requestId: unknown, deviceToken: unknown) {
    const request = this.resolveDeviceRequest(requestId, deviceToken);
    if (!request || !activeState(request.state) || request.state === 'consuming') return false;
    this.requests.delete(request.requestId);
    return true;
  }

  cleanupExpired() {
    return this.cleanupInternal(this.now());
  }

  private resolveDeviceRequest(requestId: unknown, deviceToken: unknown) {
    if (!validOpaqueToken(requestId) || !validOpaqueToken(deviceToken)) return null;
    const request = this.requests.get(requestId);
    if (!request) return null;
    this.refreshExpiration(request, this.now());
    if (!secretMatches(request.deviceTokenHash, deviceToken)) return null;
    return request;
  }

  private resolveApprovalRequest(approvalToken: unknown) {
    if (!validOpaqueToken(approvalToken)) return null;
    const now = this.now();
    const candidateHash = hashSecret(approvalToken);
    for (const request of this.requests.values()) {
      this.refreshExpiration(request, now);
      if (timingSafeEqual(request.approvalTokenHash, candidateHash)) return request;
    }
    return null;
  }

  private refreshExpiration(request: DeviceLoginRequest, now: number) {
    if (!activeState(request.state) || request.expiresAt > now) return;
    request.state = 'expired';
    request.approvedUserId = null;
    request.terminalAt = now;
  }

  private cleanupInternal(now: number) {
    let removed = 0;
    for (const request of this.requests.values()) {
      this.refreshExpiration(request, now);
      if (request.terminalAt === null) continue;
      if (request.terminalAt + this.terminalRetentionMs > now) continue;
      this.requests.delete(request.requestId);
      removed += 1;
    }
    for (const [key, entry] of this.startRateLimits) {
      if (entry.resetAt <= now) this.startRateLimits.delete(key);
    }
    return removed;
  }

  private recordStartAttempt(originKey: string, now: number) {
    for (const [key, entry] of this.startRateLimits) {
      if (entry.resetAt <= now) this.startRateLimits.delete(key);
    }

    const key = this.startRateLimits.has(originKey) || this.startRateLimits.size < this.maxRateLimitEntries
      ? originKey
      : RATE_LIMIT_OVERFLOW_KEY;
    const current = this.startRateLimits.get(key);
    if (!current) {
      this.startRateLimits.set(key, { count: 1, resetAt: now + this.startRateLimitWindowMs });
      return;
    }
    if (current.count >= this.startRateLimitMax) {
      throw new TvDeviceLoginRateLimitError(
        Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      );
    }
    current.count += 1;
  }

  private retryAfterFor(requests: DeviceLoginRequest[], now: number) {
    const earliestExpiration = Math.min(...requests.map(request => request.expiresAt));
    return Math.max(1, Math.ceil((earliestExpiration - now) / 1000));
  }
}
