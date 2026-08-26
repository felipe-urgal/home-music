import { useState, type FormEvent } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  ChevronLeft,
  KeyRound,
  LoaderCircle,
  LogOut,
  MonitorOff,
  ShieldCheck,
  UserRound
} from 'lucide-react';
import {
  changeOwnPassword,
  passwordChangeValidation,
  revokeOtherSessions
} from '../account-client';

type MyAccountScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
  onSessionEnded: () => Promise<void>;
  onLogout: () => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export function MyAccountScreen({ currentUser, onBack, onSessionEnded, onLogout }: MyAccountScreenProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validationError = passwordChangeValidation(currentPassword, newPassword, confirmation);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationError || changingPassword) return;
    if (!window.confirm('Alterar sua senha agora? Todas as suas sessões serão encerradas, inclusive esta, e será necessário entrar novamente.')) return;

    setChangingPassword(true);
    setError(null);
    setNotice(null);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      await onSessionEnded();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setChangingPassword(false);
    }
  }

  async function revokeOthers() {
    if (revokingSessions) return;
    if (!window.confirm('Encerrar todas as outras sessões desta conta? Este dispositivo continuará conectado.')) return;

    setRevokingSessions(true);
    setError(null);
    setNotice(null);
    try {
      const revoked = await revokeOtherSessions();
      setNotice(revoked === 0
        ? 'Nenhuma outra sessão estava ativa.'
        : `${revoked} ${revoked === 1 ? 'outra sessão foi encerrada' : 'outras sessões foram encerradas'}.`
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRevokingSessions(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await onLogout();
    } catch (error) {
      setError(errorMessage(error));
      setSigningOut(false);
    }
  }

  return (
    <section className="my-account-screen" aria-labelledby="my-account-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="my-account-title">Minha conta</strong>
          <small>Segurança e sessões</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <section className="my-account-profile" aria-label="Identidade atual">
        <span className="my-account-profile__icon"><UserRound /></span>
        <div>
          <strong>{currentUser.username}</strong>
          <small>{currentUser.role === 'admin' ? 'Administrador' : 'Usuário'}</small>
        </div>
        <span className="my-account-profile__badge"><ShieldCheck /> Sessão ativa</span>
      </section>

      {error && <div className="my-account-message is-error" role="alert">{error}</div>}
      {notice && <div className="my-account-message" role="status">{notice}</div>}

      <section className="my-account-card" aria-labelledby="my-account-password-title">
        <div className="my-account-card__heading">
          <span className="my-account-card__icon"><KeyRound /></span>
          <div>
            <strong id="my-account-password-title">Alterar senha</strong>
            <small>Use sua senha atual para confirmar a mudança.</small>
          </div>
        </div>

        <form className="my-account-password-form" onSubmit={submitPassword}>
          <label>
            <span>Senha atual</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              disabled={changingPassword}
              onChange={event => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Nova senha</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              disabled={changingPassword}
              onChange={event => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Confirmar nova senha</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              disabled={changingPassword}
              onChange={event => setConfirmation(event.target.value)}
            />
          </label>

          {(currentPassword || newPassword || confirmation) && validationError && (
            <small className="my-account-password-form__hint">{validationError}</small>
          )}

          <button className="primary-action my-account-action" type="submit" disabled={changingPassword || Boolean(validationError)}>
            {changingPassword && <LoaderCircle className="my-account-spinner" />}
            {changingPassword ? 'Alterando…' : 'Alterar senha e sair'}
          </button>
        </form>

        <p className="my-account-card__note">Ao trocar a senha, todas as sessões da conta serão encerradas por segurança. Entre novamente usando a nova senha.</p>
      </section>

      <section className="my-account-card" aria-labelledby="my-account-sessions-title">
        <div className="my-account-card__heading">
          <span className="my-account-card__icon"><MonitorOff /></span>
          <div>
            <strong id="my-account-sessions-title">Outros dispositivos</strong>
            <small>Encerre acessos antigos sem sair deste dispositivo.</small>
          </div>
        </div>

        <button className="secondary-action my-account-action" type="button" disabled={revokingSessions} onClick={() => void revokeOthers()}>
          {revokingSessions && <LoaderCircle className="my-account-spinner" />}
          {revokingSessions ? 'Encerrando…' : 'Sair dos outros dispositivos'}
        </button>
      </section>

      <section className="my-account-card" aria-labelledby="my-account-current-session-title">
        <div className="my-account-card__heading">
          <span className="my-account-card__icon my-account-card__icon--danger"><LogOut /></span>
          <div>
            <strong id="my-account-current-session-title">Sessão atual</strong>
            <small>Encerre sua sessão neste dispositivo.</small>
          </div>
        </div>

        <button className="secondary-action my-account-action my-account-action--danger" type="button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut && <LoaderCircle className="my-account-spinner" />}
          {signingOut ? 'Saindo…' : 'Sair desta conta'}
        </button>
      </section>
    </section>
  );
}
