import type { AuthStatusResponse, AuthenticatedUser } from '@home-music/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_REQUIRED_EVENT } from './api-client';
import { AuthRequestSequence } from './auth-request-sequence';
import { fetchAuthStatusResponse } from './auth-status-bootstrap';
import { forgetOfflineUserId, rememberOfflineUserId } from './offline-user';

async function messageFromResponse(response: Response) {
  try {
    const value = await response.json() as { error?: string };
    return value.error || `Falha HTTP ${response.status}`;
  } catch {
    return `Falha HTTP ${response.status}`;
  }
}

async function loginFailureMessage(response: Response) {
  // Never reflect identity-specific errors from the login endpoint.
  if (response.status === 401) return 'Usuário ou senha inválidos.';
  const message = await messageFromResponse(response);
  const retryAfter = Number(response.headers.get('Retry-After'));
  if ((response.status === 429 || response.status === 503)
    && Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 3600) {
    return `${message} Aguarde ${retryAfter} segundos antes de tentar novamente.`;
  }
  return message;
}

type AuthMutation = 'login' | 'logout' | 'password';

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [passwordChangeUser, setPasswordChangeUser] = useState<AuthenticatedUser | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new AuthRequestSequence());
  const mounted = useRef(false);
  const mutation = useRef<AuthMutation | null>(null);

  const clearSession = useCallback(() => {
    forgetOfflineUserId();
    setAuthenticated(false);
    setCurrentUser(null);
    setPasswordChangeUser(null);
    setUnreachable(false);
    setError(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async (fromMutation = false) => {
    if (!mounted.current || (mutation.current && !fromMutation)) return;
    const request = requests.current.begin();
    setLoading(true);
    let reachedServer = false;
    try {
      const response = await fetchAuthStatusResponse({ signal: request.signal });
      reachedServer = true;
      if (!request.isCurrent()) return;
      if (!response.ok) throw new Error(await messageFromResponse(response));
      const status = await response.json() as AuthStatusResponse;
      if (!request.isCurrent()) return;

      setConfigured(status.configured);
      setUnreachable(false);
      if (status.authenticated && status.passwordChangeRequired && status.user) {
        forgetOfflineUserId();
        setAuthenticated(false);
        setCurrentUser(null);
        setPasswordChangeUser(status.user);
      } else {
        const user = status.authenticated ? status.user : null;
        if (user) rememberOfflineUserId(user.id);
        else forgetOfflineUserId();
        setAuthenticated(Boolean(status.authenticated && user));
        setCurrentUser(user);
        setPasswordChangeUser(null);
      }
      setError(null);
    } catch (caught) {
      if (!request.isCurrent()) return;
      if (reachedServer) forgetOfflineUserId();
      setAuthenticated(false);
      setCurrentUser(null);
      // If a mandatory-password screen is already active, loss of network
      // must not release that gate into the offline player.
      if (reachedServer) setPasswordChangeUser(null);
      const offline = !reachedServer;
      setUnreachable(offline);
      setError(offline
        ? 'Home Music indisponível. Verifique sua conexão.'
        : caught instanceof Error ? caught.message : 'Não foi possível verificar a sessão.'
      );
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    requests.current.resume();
    void refresh();

    // A 401 from an old API request must not override a newly established
    // cookie. Revalidate against the server instead of logging out on event.
    const onAuthRequired = () => {
      if (!mutation.current) void refresh();
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
      mounted.current = false;
      requests.current.dispose();
    };
  }, [refresh]);

  const beginMutation = useCallback((kind: AuthMutation) => {
    if (mutation.current) throw new Error('Já existe uma operação de sessão em andamento.');
    mutation.current = kind;
    requests.current.invalidate();
    if (mounted.current) {
      setLoading(false);
      setError(null);
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    beginMutation('login');
    try {
      let response: Response;
      try {
        response = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Home-Music-Request': '1'
          },
          body: JSON.stringify({ username, password })
        });
      } catch {
        if (mounted.current) setUnreachable(true);
        throw new Error('Home Music indisponível. Verifique sua conexão e tente novamente.');
      }
      if (mounted.current) setUnreachable(false);
      if (!response.ok) throw new Error(await loginFailureMessage(response));

      const result = await response.json() as { passwordChangeRequired?: boolean };
      if (mounted.current) {
        setConfigured(true);
        await refresh(true);
      }
      return { passwordChangeRequired: result.passwordChangeRequired === true };
    } catch (caught) {
      const reason = caught instanceof Error ? caught : new Error('Não foi possível entrar.');
      if (mounted.current) setError(reason.message);
      throw reason;
    } finally {
      mutation.current = null;
    }
  }, [beginMutation, refresh]);

  const logout = useCallback(async () => {
    beginMutation('logout');
    try {
      let response: Response;
      try {
        response = await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Home-Music-Request': '1' }
        });
      } catch {
        throw new Error('Não foi possível confirmar o logout. Verifique a conexão e tente novamente.');
      }
      if (!response.ok && response.status !== 401) {
        throw new Error(await messageFromResponse(response));
      }
      requests.current.invalidate();
      forgetOfflineUserId();
      if (mounted.current) clearSession();
    } catch (caught) {
      const reason = caught instanceof Error ? caught : new Error('Não foi possível sair.');
      if (mounted.current) setError(reason.message);
      throw reason;
    } finally {
      mutation.current = null;
    }
  }, [beginMutation, clearSession]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    beginMutation('password');
    try {
      let response: Response;
      try {
        response = await fetch('/api/auth/password', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Home-Music-Request': '1'
          },
          body: JSON.stringify({ currentPassword, newPassword })
        });
      } catch {
        throw new Error('Não foi possível alterar a senha. Verifique sua conexão.');
      }
      if (!response.ok) throw new Error(await messageFromResponse(response));
      // The server revokes all sessions and expires this cookie on success.
      requests.current.invalidate();
      forgetOfflineUserId();
      if (mounted.current) clearSession();
    } finally {
      mutation.current = null;
    }
  }, [beginMutation, clearSession]);

  return {
    loading, configured, authenticated, currentUser, passwordChangeUser,
    unreachable, error, login, logout, changePassword, retry: refresh
  };
}
