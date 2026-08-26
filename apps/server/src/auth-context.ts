import type { AuthenticatedUser } from '@home-music/shared';
import type { AuthSession, SessionManager } from './auth.js';
import type { AuthenticatedUserState } from './user-auth-store.js';

export type UserIdentityReader = {
  getEnabledUserById(userId: string): AuthenticatedUserState | null;
};

export type SessionIdentity =
  | { kind: 'unauthenticated'; user: null; session: null; passwordMustChange: false }
  | { kind: 'legacy'; user: null; session: AuthSession; passwordMustChange: false }
  | { kind: 'user'; user: AuthenticatedUser; session: AuthSession; passwordMustChange: boolean };

export function resolveSessionIdentity(
  token: string | undefined,
  sessions: Pick<SessionManager, 'getSession' | 'revokeSession'>,
  users: UserIdentityReader
): SessionIdentity {
  const session = sessions.getSession(token);
  if (!session) {
    return { kind: 'unauthenticated', user: null, session: null, passwordMustChange: false };
  }

  // Exceção transitória enquanto o bootstrap ainda não conseguiu persistir o
  // primeiro usuário. Nunca deve ser suficiente para autorização administrativa.
  if (!session.userId) {
    return { kind: 'legacy', user: null, session, passwordMustChange: false };
  }

  const state = users.getEnabledUserById(session.userId);
  if (!state) {
    sessions.revokeSession(token);
    return { kind: 'unauthenticated', user: null, session: null, passwordMustChange: false };
  }

  const user: AuthenticatedUser = {
    id: state.id,
    username: state.username,
    role: state.role
  };

  return {
    kind: 'user',
    user,
    session,
    passwordMustChange: state.passwordMustChange
  };
}
