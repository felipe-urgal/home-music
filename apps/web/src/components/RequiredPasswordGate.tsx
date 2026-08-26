import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AuthStatusResponse, AuthenticatedUser } from '@home-music/shared';
import { PASSWORD_CHANGE_REQUIRED_EVENT } from '../api-client';
import { RequiredPasswordChangeScreen } from './RequiredPasswordChangeScreen';

type PasswordChangeEvent = CustomEvent<{ user?: AuthenticatedUser }>;

type RequiredPasswordGateProps = {
  children: ReactNode;
};

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `Falha HTTP ${response.status}`;
  } catch {
    return `Falha HTTP ${response.status}`;
  }
}

export function RequiredPasswordGate({ children }: RequiredPasswordGateProps) {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/status', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const status = await response.json() as AuthStatusResponse;
      setUser(status.authenticated && status.passwordChangeRequired ? status.user : null);
    } catch {
      // App/useAuth mantém a experiência de erro/retry quando o servidor não responde.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const requirePasswordChange = (event: Event) => {
      const detail = (event as PasswordChangeEvent).detail;
      if (detail?.user) setUser(detail.user);
      else void check();
    };
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, requirePasswordChange);
    return () => window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, requirePasswordChange);
  }, [check]);

  async function changePassword(currentPassword: string, newPassword: string) {
    const response = await fetch('/api/auth/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!response.ok) throw new Error(await responseError(response));
    setUser(null);
  }

  async function logout() {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Home-Music-Request': '1' }
    });
    if (!response.ok && response.status !== 401) throw new Error(await responseError(response));
    setUser(null);
  }

  if (checking) {
    return (
      <main className="login-shell">
        <section className="login-card login-card--status" aria-live="polite">
          <strong>Home Music</strong>
          <span>Verificando sua sessão…</span>
        </section>
      </main>
    );
  }

  if (user) {
    return (
      <RequiredPasswordChangeScreen
        username={user.username}
        error={null}
        onChangePassword={changePassword}
        onLogout={logout}
      />
    );
  }

  return children;
}
