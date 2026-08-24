import { useCallback, useEffect, useState } from 'react';
import { AUTH_REQUIRED_EVENT } from './api-client';

type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
};

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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/status', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(await messageFromResponse(response));
      const status = await response.json() as AuthStatus;
      setConfigured(status.configured);
      setAuthenticated(status.authenticated);
      setError(null);
    } catch (error) {
      setAuthenticated(false);
      setError(error instanceof Error ? error.message : 'Não foi possível verificar a sessão.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const expire = () => setAuthenticated(false);
    window.addEventListener(AUTH_REQUIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, expire);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const message = await messageFromResponse(response);
      setError(message);
      throw new Error(message);
    }

    setAuthenticated(true);
    setConfigured(true);
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Home-Music-Request': '1' }
    }).catch(() => undefined);
    setAuthenticated(false);
  }, []);

  return {
    loading,
    configured,
    authenticated,
    error,
    login,
    logout,
    retry: refresh
  };
}
