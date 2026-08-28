import { useEffect, useState, type FormEvent } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  Music2,
  UserRound
} from 'lucide-react';
import { canStorePasswordCredential, storePasswordCredential } from '../password-credentials';

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
  const [savePassword, setSavePassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const autoOpeningOffline = offlineCount > 0 && Boolean(onOpenOffline);
  const canSavePassword = canStorePasswordCredential();

  useEffect(() => {
    if (autoOpeningOffline) onOpenOffline?.();
  }, [autoOpeningOffline, onOpenOffline]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) return;

    const normalizedUsername = username.trim();
    setSubmitting(true);
    setFormError(null);
    try {
      await onLogin(normalizedUsername, password);
      if (savePassword && canSavePassword) {
        await storePasswordCredential(normalizedUsername, password);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível entrar.');
    } finally {
      setSubmitting(false);
    }
  }

  if (autoOpeningOffline) {
    return (
      <main className="login-shell">
        <section className="login-card login-card--status" aria-live="polite">
          <div className="login-brand__icon"><Download /></div>
          <strong>Modo offline</strong>
          <span>Abrindo suas músicas baixadas…</span>
        </section>
      </main>
    );
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

          {canSavePassword && (
            <label className="login-save-password">
              <input
                type="checkbox"
                checked={savePassword}
                disabled={submitting}
                onChange={event => setSavePassword(event.target.checked)}
              />
              <span>
                <strong>Salvar senha neste dispositivo</strong>
                <small>Usa o gerenciador seguro de senhas do navegador.</small>
              </span>
            </label>
          )}

          {(formError || error) && <div className="login-error" role="alert">{formError || error}</div>}

          <button className="login-submit" type="submit" disabled={submitting || !username.trim() || !password}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="login-footnote"><LockKeyhole /> Sessão protegida neste navegador.</p>
      </section>
    </main>
  );
}
