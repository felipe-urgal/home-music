import type {
  AdminUser,
  AdminUserCreateResponse,
  AdminUserPasswordResetResponse,
  AdminUsersResponse,
  AdminUserSessionsRevokeResponse,
  UserRole
} from '@home-music/shared';
import { apiFetch } from './api-client';

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-Home-Music-Request', '1');

  const response = await apiFetch(url, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function jsonBody(value: unknown) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  };
}

export function canManageAdminTarget(currentUserId: string, targetUserId: string) {
  return currentUserId !== targetUserId;
}

export async function listAdminUsers() {
  const response = await adminRequest<AdminUsersResponse>('/api/admin/users');
  return response.users;
}

export function createAdminUser(username: string, role: UserRole) {
  return adminRequest<AdminUserCreateResponse>('/api/admin/users', {
    method: 'POST',
    ...jsonBody({ username, role })
  });
}

export async function updateAdminUser(id: string, username: string, role: UserRole, enabled: boolean) {
  const response = await adminRequest<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    ...jsonBody({ username, role, enabled })
  });
  return response.user;
}

export function deleteAdminUser(id: string) {
  return adminRequest<{ deleted: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function setAdminUserRole(id: string, role: UserRole) {
  const response = await adminRequest<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    ...jsonBody({ role })
  });
  return response.user;
}

export async function setAdminUserEnabled(id: string, enabled: boolean) {
  const response = await adminRequest<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}/enabled`, {
    method: 'PATCH',
    ...jsonBody({ enabled })
  });
  return response.user;
}

export function resetAdminUserPassword(id: string) {
  return adminRequest<AdminUserPasswordResetResponse>(`/api/admin/users/${encodeURIComponent(id)}/password-reset`, { method: 'POST' });
}

export function revokeAdminUserSessions(id: string) {
  return adminRequest<AdminUserSessionsRevokeResponse>(`/api/admin/users/${encodeURIComponent(id)}/sessions/revoke`, { method: 'POST' });
}
