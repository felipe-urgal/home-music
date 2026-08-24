import { useState, type FormEvent } from 'react';
import { LockKeyhole, Music2 } from 'lucide-react';

type LoginScreenProps = {
  configured: boolean;
  error: string | null;
  onLogin: (username: string, password: string) => Promise<void>;
  onRetry: () => void;
};

export function LoginScreen({ configured, error, onLogin, onRetry }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
          <p>Use as credenciais configuradas no seu Home Music.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Usuário</span>
            <input
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
          </label>

          <label>
            <span>Senha</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          {(formError || error) && <div className="login-error" role="alert">{formError || error}</div>}

          <button className="login-submit" type="submit" disabled={submitting || !username.trim() || !password}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="login-footnote"><LockKeyhole /> A sessão fica protegida por cookie HttpOnly neste navegador.</p>
      </section>
    </main>
  );
}
