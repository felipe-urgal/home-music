import type { AuthStatusResponse, AuthenticatedUser } from '@home-music/shared';
import type { SessionManager } from './auth.js';

type UserIdentityReader = {
  getEnabledUserById(userId: string): AuthenticatedUser | null;
};

export function resolveAuthStatus(
  configured: boolean,
  token: string | undefined,
  sessions: Pick<SessionManager, 'getSession' | 'revokeSession'>,
  users: UserIdentityReader
): AuthStatusResponse {
  if (!configured) {
    return { configured: false, authenticated: false, user: null };
  }

  const session = sessions.getSession(token);
  if (!session) {
    return { configured: true, authenticated: false, user: null };
  }

  // Exceção transitória: enquanto o bootstrap ainda não conseguiu persistir o
  // primeiro usuário, o fluxo legado pode continuar autenticado sem userId.
  // Esse estado desaparece quando a migração para autenticação SQLite estiver completa.
  if (!session.userId) {
    return { configured: true, authenticated: true, user: null };
  }

  const user = users.getEnabledUserById(session.userId);
  if (!user) {
    sessions.revokeSession(token);
    return { configured: true, authenticated: false, user: null };
  }

  return { configured: true, authenticated: true, user };
}
