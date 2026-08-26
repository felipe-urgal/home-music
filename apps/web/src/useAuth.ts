import type { AuthStatusResponse, AuthenticatedUser } from '@home-music/shared';
import { useCallback, useEffect, useState } from 'react';
import { AUTH_REQUIRED_EVENT, PASSWORD_CHANGE_REQUIRED_EVENT } from './api-client';

function messageFromResponse(response: Response) {
  return response.json()
    .then(value => value as { error?: string })
    .then(value => value.error || `Falha HTTP ${response.status}`)
    .catch(() => `Falha HTTP ${response.status}`);
}

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    let reachedServer = false;
    try {
      const response = await fetch('/api/auth/status', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      reachedServer = true;
      setUnreachable(false);
      if (!response.ok) throw new Error(await messageFromResponse(response));
      const status = await response.json() as AuthStatusResponse;
      setConfigured(status.configured);

      if (status.authenticated && status.passwordChangeRequired && status.user) {
        setAuthenticated(false);
        setCurrentUser(null);
        window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT, {
          detail: { user: status.user }
        }));
      } else {
        setAuthenticated(status.authenticated);
        setCurrentUser(status.authenticated ? status.user : null);
      }
      setError(null);
    } catch (error) {
      setAuthenticated(false);
      setCurrentUser(null);
      const offline = !reachedServer;
      setUnreachable(offline);
      setError(offline
        ? 'Home Music indisponível. Verifique sua conexão.'
        : error instanceof Error ? error.message : 'Não foi possível verificar a sessão.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const expire = () => {
      setAuthenticated(false);
      setCurrentUser(null);
      setUnreachable(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, expire);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
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
      const message = 'Home Music indisponível. Verifique sua conexão e tente novamente.';
      setUnreachable(true);
      setError(message);
      throw new Error(message);
    }

    setUnreachable(false);
    if (!response.ok) {
      const message = await messageFromResponse(response);
      setError(message);
      throw new Error(message);
    }

    setConfigured(true);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    setError(null);

    let response: Response;
    try {
      response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Home-Music-Request': '1' }
      });
    } catch {
      const message = 'Não foi possível confirmar o logout. Verifique a conexão e tente novamente.';
      setError(message);
      throw new Error(message);
    }

    if (!response.ok && response.status !== 401) {
      const message = await messageFromResponse(response);
      setError(message);
      throw new Error(message);
    }

    setAuthenticated(false);
    setCurrentUser(null);
    setUnreachable(false);
  }, []);

  return {
    loading,
    configured,
    authenticated,
    currentUser,
    unreachable,
    error,
    login,
    logout,
    retry: refresh
  };
}
