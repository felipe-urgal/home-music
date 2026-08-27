import { useEffect, useState, type FormEvent } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  LogOut,
  MonitorOff,
  Settings2,
  ShieldCheck,
  UserRound,
  Users
} from 'lucide-react';
import {
  changeOwnPassword,
  listOwnSessions,
  MIN_ACCOUNT_PASSWORD_CHARACTERS,
  passwordChangeValidation,
  revokeOtherSessions,
  revokeOwnSession,
  type AccountSession
} from '../account-client';
import {
  AccountPlaybackPreferences,
  type AccountPlaybackPreferencesValue
} from './AccountPlaybackPreferences';
import { AdminUsersScreen } from './AdminUsersScreen';

type AccountView = 'overview' | 'password' | 'sessions' | 'playback' | 'users';

type MyAccountScreenProps = {
  currentUser: AuthenticatedUser;
  playbackPreferences?: AccountPlaybackPreferencesValue;
  onBack: () => void;
  onSessionEnded: () => Promise<void>;
  onLogout: () => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function formatSessionDate(value: number) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function MyAccountScreen({
  currentUser,
  playbackPreferences,
  onBack,
  onSessionEnded,
  onLogout
}: MyAccountScreenProps) {
  const [view, setView] = useState<AccountView>('overview');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validationError = passwordChangeValidation(currentPassword, newPassword, confirmation);

  useEffect(() => {
    if (view !== 'sessions') return;
    let active = true;
    setLoadingSessions(true);
    setError(null);
    void listOwnSessions()
      .then(items => { if (active) setSessions(items); })
      .catch(error => { if (active) setError(errorMessage(error)); })
      .finally(() => { if (active) setLoadingSessions(false); });
    return () => { active = false; };
  }, [view]);

  function goBack() {
    setError(null);
    setNotice(null);
    if (view === 'overview') onBack();
    else setView('overview');
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationError || changingPassword) return;
    if (!window.confirm('Alterar sua senha agora? Todas as suas sessões serão encerradas, inclusive esta, e será necessário entrar novamente.')) return;

    setChangingPassword(true);
    setError(null);
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
    try {
      const revoked = await revokeOtherSessions();
      setSessions(items => items.filter(item => item.current));
      setNotice(revoked === 0 ? 'Nenhuma outra sessão estava ativa.' : `${revoked} ${revoked === 1 ? 'sessão foi encerrada' : 'sessões foram encerradas'}.`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRevokingSessions(false);
    }
  }

  async function revokeOne(session: AccountSession) {
    if (session.current || busySessionId) return;
    if (!window.confirm('Encerrar esta sessão? O dispositivo precisará entrar novamente.')) return;
    setBusySessionId(session.id);
    setError(null);
    try {
      await revokeOwnSession(session.id);
      setSessions(items => items.filter(item => item.id !== session.id));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusySessionId(null);
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

  if (view === 'users' && currentUser.role === 'admin') {
    return <AdminUsersScreen currentUser={currentUser} onBack={() => setView('overview')} />;
  }

  const title = view === 'password'
    ? 'Alterar senha'
    : view === 'sessions'
      ? 'Outros dispositivos'
      : view === 'playback'
        ? 'Reprodução'
        : 'Minha conta';
  const subtitle = view === 'password'
    ? 'Atualize sua senha de acesso'
    : view === 'sessions'
      ? 'Gerencie sessões em dispositivos'
      : view === 'playback'
        ? 'Qualidade e normalização'
        : 'Segurança e sessões';

  return (
    <section className={`my-account-screen my-account-screen--${view}`} aria-labelledby="my-account-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={goBack}><ChevronLeft /></button>
        <div>
          <strong id="my-account-title">{title}</strong>
          <small>{subtitle}</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      {error && <div className="my-account-message is-error" role="alert">{error}</div>}
      {notice && <div className="my-account-message" role="status">{notice}</div>}

      {view === 'overview' && (
        <div className="my-account-overview">
          <section className="my-account-profile" aria-label="Identidade atual">
            <span className="my-account-profile__icon"><UserRound /></span>
            <div>
              <strong>{currentUser.username}</strong>
              <small>{currentUser.role === 'admin' ? 'Administrador' : 'Usuário'}</small>
            </div>
            <span className="my-account-profile__badge"><ShieldCheck /> Sessão ativa</span>
          </section>

          <section className="my-account-link-group" aria-labelledby="my-account-group-account">
            <span className="my-account-link-group__label" id="my-account-group-account">Conta</span>
            <div className="my-account-links">
              <button type="button" onClick={() => setView('password')}>
                <span className="my-account-card__icon"><KeyRound /></span>
                <span><strong>Alterar senha</strong><small>Use sua senha atual para confirmar a mudança.</small></span>
                <ChevronRight />
              </button>
              <button type="button" onClick={() => setView('sessions')}>
                <span className="my-account-card__icon"><MonitorOff /></span>
                <span><strong>Outros dispositivos</strong><small>Encerre acessos antigos sem sair deste dispositivo.</small></span>
                <ChevronRight />
              </button>
            </div>
          </section>

          {playbackPreferences && (
            <section className="my-account-link-group" aria-labelledby="my-account-group-preferences">
              <span className="my-account-link-group__label" id="my-account-group-preferences">Preferências</span>
              <div className="my-account-links">
                <button type="button" onClick={() => setView('playback')}>
                  <span className="my-account-card__icon"><Settings2 /></span>
                  <span><strong>Reprodução</strong><small>Qualidade, conexão e normalização.</small></span>
                  <ChevronRight />
                </button>
              </div>
            </section>
          )}

          {currentUser.role === 'admin' && (
            <section className="my-account-link-group" aria-labelledby="my-account-group-admin">
              <span className="my-account-link-group__label" id="my-account-group-admin">Administração</span>
              <div className="my-account-links">
                <button type="button" onClick={() => setView('users')}>
                  <span className="my-account-card__icon"><Users /></span>
                  <span><strong>Usuários</strong><small>Gerencie usuários, papéis e permissões.</small></span>
                  <ChevronRight />
                </button>
              </div>
            </section>
          )}

          <section className="my-account-danger" aria-labelledby="my-account-current-session-title">
            <div className="my-account-card__heading">
              <span className="my-account-card__icon my-account-card__icon--danger"><LogOut /></span>
              <div>
                <strong id="my-account-current-session-title">Sair da conta</strong>
                <small>Encerre sua sessão neste dispositivo.</small>
              </div>
            </div>
            <button className="my-account-action my-account-action--danger" type="button" disabled={signingOut} onClick={() => void signOut()}>
              {signingOut && <LoaderCircle className="my-account-spinner" />}
              {signingOut ? 'Saindo…' : 'Sair da conta'}
            </button>
          </section>
        </div>
      )}

      {view === 'password' && (
        <section className="my-account-card my-account-password-card">
          <div className="my-account-card__heading">
            <span className="my-account-card__icon"><KeyRound /></span>
            <div><strong>Alterar senha</strong><small>Use sua senha atual para confirmar a mudança.</small></div>
          </div>
          <form className="my-account-password-form" onSubmit={submitPassword}>
            <label className="my-account-password-form__current"><span>Senha atual</span><input type="password" autoComplete="current-password" value={currentPassword} disabled={changingPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
            <label><span>Nova senha</span><input type="password" autoComplete="new-password" value={newPassword} disabled={changingPassword} onChange={event => setNewPassword(event.target.value)} /></label>
            <label><span>Confirmar nova senha</span><input type="password" autoComplete="new-password" value={confirmation} disabled={changingPassword} onChange={event => setConfirmation(event.target.value)} /></label>
            <div className="my-account-password-rules" aria-label="Requisitos da senha">
              <span className={Array.from(newPassword).length >= MIN_ACCOUNT_PASSWORD_CHARACTERS ? 'is-valid' : ''}><CheckCircle2 /> Pelo menos {MIN_ACCOUNT_PASSWORD_CHARACTERS} caracteres</span>
              <span className={Boolean(newPassword.trim()) ? 'is-valid' : ''}><CheckCircle2 /> Não conter somente espaços</span>
              <span className={Boolean(currentPassword && newPassword && currentPassword !== newPassword) ? 'is-valid' : ''}><CheckCircle2 /> Ser diferente da senha atual</span>
            </div>
            {(currentPassword || newPassword || confirmation) && validationError && <small className="my-account-password-form__hint">{validationError}</small>}
            <button className="primary-action my-account-action" type="submit" disabled={changingPassword || Boolean(validationError)}>{changingPassword && <LoaderCircle className="my-account-spinner" />}{changingPassword ? 'Alterando…' : 'Alterar senha e sair'}</button>
          </form>
          <p className="my-account-card__note">Ao trocar a senha, todas as sessões da conta serão encerradas por segurança. Entre novamente usando a nova senha.</p>
        </section>
      )}

      {view === 'sessions' && (
        <section className="my-account-card my-account-sessions-card">
          <div className="my-account-card__heading">
            <span className="my-account-card__icon"><MonitorOff /></span>
            <div><strong>Outros dispositivos</strong><small>Encerre acessos antigos sem sair deste dispositivo.</small></div>
          </div>
          <strong className="my-account-sessions-card__label">Dispositivos com sessão ativa</strong>
          {loadingSessions ? (
            <div className="my-account-sessions-loading"><LoaderCircle className="my-account-spinner" /> Carregando sessões…</div>
          ) : (
            <div className="my-account-session-list">
              {sessions.map((session, index) => (
                <div className="my-account-session-row" key={session.id}>
                  <span className="my-account-session-row__icon">{session.current ? <UserRound /> : <MonitorOff />}</span>
                  <div><strong>{session.current ? 'Este dispositivo' : `Outro dispositivo ${index}`}</strong><small>{session.current ? 'Sessão atual' : `Última atividade ${formatSessionDate(session.lastSeenAt)}`}</small></div>
                  {session.current ? <span className="my-account-session-current">Atual</span> : <button type="button" disabled={busySessionId === session.id} onClick={() => void revokeOne(session)}>{busySessionId === session.id ? 'Encerrando…' : 'Encerrar'}</button>}
                </div>
              ))}
            </div>
          )}
          <button className="secondary-action my-account-action" type="button" disabled={revokingSessions || sessions.every(session => session.current)} onClick={() => void revokeOthers()}>{revokingSessions ? 'Encerrando…' : 'Encerrar todas as outras sessões'}</button>
          <p className="my-account-card__note">Se você não reconhecer uma sessão, encerre o acesso e altere sua senha.</p>
        </section>
      )}

      {view === 'playback' && playbackPreferences && (
        <AccountPlaybackPreferences value={playbackPreferences} />
      )}
    </section>
  );
}
