import type {
  OpenSubsonicAccountKey,
  OpenSubsonicKeyCreateResponse,
  OpenSubsonicKeysResponse
} from '@home-music/shared/open-subsonic';
import { apiFetch } from './api-client';

export const MIN_ACCOUNT_PASSWORD_CHARACTERS = 12;
const MAX_ACCOUNT_PASSWORD_BYTES = 1024;

export type AccountSession = {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type AccountOpenSubsonicKey = OpenSubsonicAccountKey;

type RevokeOtherSessionsResponse = {
  revoked: number;
};

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `Falha HTTP ${response.status}`;
  } catch {
    return `Falha HTTP ${response.status}`;
  }
}

function passwordByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isAccountSession(value: unknown): value is AccountSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AccountSession>;
  return typeof session.id === 'string'
    && typeof session.current === 'boolean'
    && Number.isFinite(session.createdAt)
    && Number.isFinite(session.lastSeenAt)
    && Number.isFinite(session.expiresAt);
}

function isOpenSubsonicKey(value: unknown): value is OpenSubsonicAccountKey {
  if (!value || typeof value !== 'object') return false;
  const key = value as Partial<OpenSubsonicAccountKey>;
  return typeof key.id === 'string'
    && typeof key.name === 'string'
    && typeof key.hint === 'string'
    && typeof key.createdAt === 'string';
}

export function passwordChangeValidation(
  currentPassword: string,
  newPassword: string,
  confirmation: string
): string | null {
  if (!currentPassword) return 'Informe sua senha atual.';
  if (Array.from(newPassword).length < MIN_ACCOUNT_PASSWORD_CHARACTERS) {
    return `A nova senha precisa ter pelo menos ${MIN_ACCOUNT_PASSWORD_CHARACTERS} caracteres.`;
  }
  if (!newPassword.trim()) return 'A nova senha não pode conter somente espaços.';
  if (passwordByteLength(newPassword) > MAX_ACCOUNT_PASSWORD_BYTES) {
    return 'A nova senha excede o limite técnico de 1024 bytes.';
  }
  if (newPassword === currentPassword) return 'A nova senha precisa ser diferente da atual.';
  if (newPassword !== confirmation) return 'A confirmação precisa ser igual à nova senha.';
  return null;
}

export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  const response = await apiFetch('/api/auth/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!response.ok) throw new Error(await responseError(response));
}

export async function listOwnSessions() {
  const response = await apiFetch('/api/auth/sessions', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  const body = await response.json() as { sessions?: unknown[] };
  if (!Array.isArray(body.sessions) || !body.sessions.every(isAccountSession)) {
    throw new Error('Resposta inválida ao carregar sessões da conta.');
  }
  return body.sessions;
}

export async function revokeOwnSession(id: string) {
  const response = await apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
}

export async function revokeOtherSessions() {
  const response = await apiFetch('/api/auth/sessions/revoke-others', {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));

  const body = await response.json() as Partial<RevokeOtherSessionsResponse>;
  if (!Number.isSafeInteger(body.revoked) || Number(body.revoked) < 0) {
    throw new Error('Resposta inválida ao revogar outras sessões.');
  }
  return Number(body.revoked);
}

export async function listOpenSubsonicKeys() {
  const response = await apiFetch('/api/auth/open-subsonic/keys', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  const body = await response.json() as Partial<OpenSubsonicKeysResponse> & { keys?: unknown[] };
  if (!Array.isArray(body.keys) || !body.keys.every(isOpenSubsonicKey)) {
    throw new Error('Resposta inválida ao carregar chaves de aplicativos.');
  }
  return body.keys;
}

export async function createOpenSubsonicKey(name: string) {
  const response = await apiFetch('/api/auth/open-subsonic/keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(await responseError(response));

  const body = await response.json() as Partial<OpenSubsonicKeyCreateResponse>;
  if (!isOpenSubsonicKey(body.key) || typeof body.token !== 'string' || !body.token.startsWith('hm_os_')) {
    throw new Error('Resposta inválida ao criar chave de aplicativo.');
  }
  return { key: body.key, token: body.token } satisfies OpenSubsonicKeyCreateResponse;
}

export async function revokeOpenSubsonicKey(id: string) {
  const response = await apiFetch(`/api/auth/open-subsonic/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
}
