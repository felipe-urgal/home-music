import type { AuthStatusResponse } from '@home-music/shared';
import type { SessionManager } from './auth.js';
import { resolveSessionIdentity, type UserIdentityReader } from './auth-context.js';

export function resolveAuthStatus(
  configured: boolean,
  token: string | undefined,
  sessions: Pick<SessionManager, 'getSession' | 'revokeSession'>,
  users: UserIdentityReader
): AuthStatusResponse {
  if (!configured) {
    return { configured: false, authenticated: false, user: null };
  }

  const identity = resolveSessionIdentity(token, sessions, users);
  if (identity.kind === 'unauthenticated') {
    return { configured: true, authenticated: false, user: null };
  }

  return {
    configured: true,
    authenticated: true,
    user: identity.kind === 'user' ? identity.user : null
  };
}
