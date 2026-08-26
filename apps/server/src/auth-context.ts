import type { AuthenticatedUser } from '@home-music/shared';
import type { AuthSession, SessionManager } from './auth.js';

export type UserIdentityReader = {
  getEnabledUserById(userId: string): AuthenticatedUser | null;
};

export type SessionIdentity =
  | { kind: 'unauthenticated'; user: null; session: null }
  | { kind: 'legacy'; user: null; session: AuthSession }
  | { kind: 'user'; user: AuthenticatedUser; session: AuthSession };

export function resolveSessionIdentity(
  token: string | undefined,
  sessions: Pick<SessionManager, 'getSession' | 'revokeSession'>,
  users: UserIdentityReader
): SessionIdentity {
  const session = sessions.getSession(token);
  if (!session) return { kind: 'unauthenticated', user: null, session: null };

  // Exceção transitória enquanto o bootstrap ainda não conseguiu persistir o
  // primeiro usuário. Nunca deve ser suficiente para autorização administrativa.
  if (!session.userId) return { kind: 'legacy', user: null, session };

  const user = users.getEnabledUserById(session.userId);
  if (!user) {
    sessions.revokeSession(token);
    return { kind: 'unauthenticated', user: null, session: null };
  }

  return { kind: 'user', user, session };
}
