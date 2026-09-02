import { useEffect, useState, type FormEvent } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
  MonitorOff,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  WifiOff
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
import { AccountSessionsScreen } from './AccountSessionsScreen';

type AccountView = 'overview' | 'profile' | 'password' | 'sessions' | 'playback';

type OfflineModeControl = {
  supported: boolean;
  loading: boolean;
  availableCount: number;
  onOpen: () => void;
};

type MyAccountScreenProps = {
  currentUser: AuthenticatedUser;
  playbackPreferences?: AccountPlaybackPreferencesValue;
  offlineMode?: OfflineModeControl;
  onBack: () => void;
  onOpenAdministration: () => void;
  onSessionEnded: () => Promise<void>;
  onLogout: () => Promise<void>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export function MyAccountScreen({
  currentUser,
  playbackPreferences,
  offlineMode,
  onBack,
  onOpenAdministration,
  onSessionEnded,
  onLogout
}: MyAccountScreenProps) {
  const [view, setView] = useState<AccountView>('overview');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validationError = passwordChangeValidation(currentPassword, newPassword, confirmation);
  const roleLabel = currentUser.role === 'admin' ? 'Administrador' : 'Usuário';
  const offlineModeAvailable = Boolean(
    offlineMode?.supported
    && !offlineMode.loading
    && offlineMode.availableCount > 0
  );
  const offlineModeDetail = !offlineMode
    ? null
    : offlineMode.loading
      ? 'Verificando downloads salvos neste dispositivo.'
      : !offlineMode.supported
        ? 'Downloads offline não são suportados neste navegador.'
        : offlineMode.availableCount > 0
          ? `Usar somente ${offlineMode.availableCount} ${offlineMode.availableCount === 1 ? 'música salva' : 'músicas salvas'} neste dispositivo.`
          : 'Baixe músicas, playlists ou pastas para usar este modo.';

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
    setShowPasswords(false);
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
      setShowPasswords(false);
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

  const title = view === 'profile'
    ? 'Perfil'
    : view === 'password'
      ? 'Alterar senha'
      : view === 'sessions'
        ? 'Outros dispositivos'
        : view === 'playback'
          ? 'Reprodução'
          : 'Minha conta';
  const subtitle = view === 'profile'
    ? 'Informações da conta'
    : view === 'password'
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
          <button
            className="my-account-profile my-account-profile--link"
            type="button"
            onClick={() => setView('profile')}
            aria-label={`Abrir perfil de ${currentUser.username}`}
          >
            <span className="my-account-profile__icon"><UserRound /></span>
            <span>
              <strong>{currentUser.username}</strong>
              <small>{roleLabel}</small>
            </span>
            <span className="my-account-profile__end">
              <span className="my-account-profile__badge"><ShieldCheck /> Sessão ativa</span>
              <ChevronRight className="my-account-profile__open" />
            </span>
          </button>

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

          {(playbackPreferences || offlineMode) && (
            <section className="my-account-link-group" aria-labelledby="my-account-group-preferences">
              <span className="my-account-link-group__label" id="my-account-group-preferences">Preferências</span>
              <div className="my-account-links">
                {playbackPreferences && (
                  <button type="button" onClick={() => setView('playback')}>
                    <span className="my-account-card__icon"><SlidersHorizontal /></span>
                    <span><strong>Reprodução</strong><small>Qualidade, conexão e normalização.</small></span>
                    <ChevronRight />
                  </button>
                )}
                {offlineMode && (
                  <button
                    type="button"
                    disabled={!offlineModeAvailable}
                    aria-disabled={!offlineModeAvailable}
                    onClick={offlineModeAvailable ? offlineMode.onOpen : undefined}
                  >
                    <span className="my-account-card__icon"><WifiOff /></span>
                    <span><strong>Modo offline</strong><small>{offlineModeDetail}</small></span>
                    <ChevronRight />
                  </button>
                )}
              </div>
            </section>
          )}

          {currentUser.role === 'admin' && (
            <section className="my-account-link-group" aria-labelledby="my-account-group-admin">
              <span className="my-account-link-group__label" id="my-account-group-admin">Sistema</span>
              <div className="my-account-links">
                <button type="button" onClick={onOpenAdministration}>
                  <span className="my-account-card__icon"><ShieldCheck /></span>
                  <span><strong>Administração</strong><small>Usuários e controles do Home Music.</small></span>
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

      {view === 'profile' && (
        <div className="my-account-profile-page">
          <section className="my-account-profile-hero" aria-labelledby="my-account-profile-name">
            <span className="my-account-profile-hero__avatar"><UserRound /></span>
            <div className="my-account-profile-hero__identity">
              <strong id="my-account-profile-name">{currentUser.username}</strong>
              <span>{roleLabel}</span>
            </div>
            <span className="my-account-profile-hero__status"><ShieldCheck /> Sessão ativa</span>
          </section>

          <section className="my-account-profile-details" aria-labelledby="my-account-profile-details-title">
            <div className="my-account-profile-details__heading">
              <strong id="my-account-profile-details-title">Informações da conta</strong>
            </div>
            <dl>
              <div>
                <dt>Nome de usuário</dt>
                <dd>{currentUser.username}</dd>
              </div>
              <div>
                <dt>Tipo de conta</dt>
                <dd>{roleLabel}</dd>
              </div>
            </dl>
          </section>

          <section className="my-account-profile-security" aria-labelledby="my-account-profile-security-title">
            <span className="my-account-profile-security__icon"><ShieldCheck /></span>
            <div className="my-account-profile-security__copy">
              <strong id="my-account-profile-security-title">Sua conta está protegida</strong>
              <small>Use uma senha exclusiva e encerre sessões que você não reconhecer.</small>
            </div>
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
            <button
              className="my-account-password-visibility"
              type="button"
              aria-pressed={showPasswords}
              disabled={changingPassword}
              onClick={() => setShowPasswords(value => !value)}
            >
              {showPasswords ? <EyeOff /> : <Eye />}
              {showPasswords ? 'Ocultar senhas' : 'Mostrar senhas'}
            </button>
            <label className="my-account-password-form__current"><span>Senha atual</span><input type={showPasswords ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} disabled={changingPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
            <label><span>Nova senha</span><input type={showPasswords ? 'text' : 'password'} autoComplete="new-password" value={newPassword} disabled={changingPassword} onChange={event => setNewPassword(event.target.value)} /></label>
            <label><span>Confirmar nova senha</span><input type={showPasswords ? 'text' : 'password'} autoComplete="new-password" value={confirmation} disabled={changingPassword} onChange={event => setConfirmation(event.target.value)} /></label>
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
        <AccountSessionsScreen
          sessions={sessions}
          loading={loadingSessions}
          busySessionId={busySessionId}
          revokingAll={revokingSessions}
          onRevokeOne={session => void revokeOne(session)}
          onRevokeOthers={() => void revokeOthers()}
        />
      )}

      {view === 'playback' && playbackPreferences && (
        <AccountPlaybackPreferences value={playbackPreferences} />
      )}
    </section>
  );
}
