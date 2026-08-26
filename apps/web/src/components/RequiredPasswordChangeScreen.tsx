import { useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole } from 'lucide-react';

type RequiredPasswordChangeScreenProps = {
  username: string;
  error: string | null;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onLogout: () => Promise<void>;
};

export function RequiredPasswordChangeScreen({
  username,
  error,
  onChangePassword,
  onLogout
}: RequiredPasswordChangeScreenProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const newPasswordCharacters = Array.from(newPassword).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword || newPasswordCharacters < 12) return;
    if (newPassword !== confirmation) {
      setFormError('A confirmação precisa ser igual à nova senha.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await onChangePassword(currentPassword, newPassword);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível alterar a senha.');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    setSubmitting(true);
    setFormError(null);
    try {
      await onLogout();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível sair desta conta.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="password-change-title">
        <div className="login-brand">
          <div className="login-brand__icon"><KeyRound /></div>
          <div>
            <span>Home Music</span>
            <small>{username}</small>
          </div>
        </div>

        <div className="login-heading">
          <h1 id="password-change-title">Defina uma nova senha</h1>
          <p>Sua senha atual é temporária. Troque-a antes de continuar.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Senha temporária</span>
            <input
              name="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          <label>
            <span>Nova senha</span>
            <input
              name="new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          <label>
            <span>Confirmar nova senha</span>
            <input
              name="new-password-confirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              disabled={submitting}
              required
            />
          </label>

          {(formError || error) && <div className="login-error" role="alert">{formError || error}</div>}

          <button
            className="login-submit"
            type="submit"
            disabled={submitting || !currentPassword || newPasswordCharacters < 12 || newPassword !== confirmation}
          >
            {submitting ? 'Alterando…' : 'Alterar senha'}
          </button>
        </form>

        <button
          className="login-offline-action"
          type="button"
          disabled={submitting}
          onClick={() => { void logout(); }}
        >
          Sair desta conta
        </button>

        <p className="login-footnote">
          <LockKeyhole /> A nova senha deve ter pelo menos 12 caracteres e não é enviada para nenhum serviço externo.
        </p>
      </section>
    </main>
  );
}
