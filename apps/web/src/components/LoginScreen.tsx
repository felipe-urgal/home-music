import { useState, type FormEvent } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  Music2,
  UserRound
} from 'lucide-react';

type LoginScreenProps = {
  configured: boolean;
  error: string | null;
  offlineCount?: number;
  onLogin: (username: string, password: string) => Promise<void>;
  onRetry: () => void;
  onOpenOffline?: () => void;
};

export function LoginScreen({ configured, error, offlineCount = 0, onLogin, onRetry, onOpenOffline }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) return;

    setSubmitting(true);
    setFormError(null);
    try {
      await onLogin(username.trim(), password);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!configured) {
    return (
      <main className="login-shell">
        <section className="login-card login-card--status">
          <div className="login-brand__icon"><LockKeyhole /></div>
          <h1>Autenticação não configurada</h1>
          <p>Configure <code>HOME_MUSIC_USER</code> e <code>HOME_MUSIC_PASSWORD</code> no <code>.env</code> da raiz e reinicie o Home Music.</p>
          <button className="login-submit" type="button" onClick={onRetry}>Verificar novamente</button>
        </section>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="login-brand__icon"><Music2 /></div>
          <div>
            <span>Home Music</span>
            <small>Sua biblioteca pessoal</small>
          </div>
        </div>

        <div className="login-heading">
          <h1 id="login-title">Entrar</h1>
          <p>Entre para acessar sua biblioteca.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="login-field">
            <label htmlFor="login-username">Usuário</label>
            <div className="login-input-shell">
              <UserRound aria-hidden="true" />
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={event => setUsername(event.target.value)}
                disabled={submitting}
                required
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Senha</label>
            <div className="login-input-shell">
              <LockKeyhole aria-hidden="true" />
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={submitting}
                required
              />
              <button
                className="login-password-toggle"
                type="button"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
                disabled={submitting}
                onClick={() => setShowPassword(value => !value)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          {(formError || error) && <div className="login-error" role="alert">{formError || error}</div>}

          <button className="login-submit" type="submit" disabled={submitting || !username.trim() || !password}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {offlineCount > 0 && onOpenOffline && (
          <>
            <div className="login-offline-separator">Sem servidor</div>
            <button className="login-offline-action" type="button" onClick={onOpenOffline}>
              <Download /> Abrir {offlineCount} {offlineCount === 1 ? 'download offline' : 'downloads offline'}
            </button>
          </>
        )}

        <p className="login-footnote"><LockKeyhole /> Sessão protegida neste navegador.</p>
      </section>
    </main>
  );
}
