import { useEffect, useState, type FormEvent } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import {
  AudioLines,
  CheckCircle2,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Eye,
  EyeOff,
  KeyRound,
  Lightbulb,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Monitor,
  MonitorOff,
  Pencil,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
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
import { AccountOpenSubsonicKeys } from './AccountOpenSubsonicKeys';
import { AccountPersonalDataImport } from './AccountPersonalDataImport';
import {
  AccountPlaybackPreferences,
  type AccountPlaybackPreferencesValue
} from './AccountPlaybackPreferences';
import { AccountSessionsScreen } from './AccountSessionsScreen';
import { useDesktopLayout } from '../useDesktopLayout';

type AccountView = 'overview' | 'profile' | 'password' | 'sessions' | 'apps' | 'playback' | 'data-import';

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
  const desktopLayout = useDesktopLayout();
  const tvMode = typeof document !== 'undefined' && document.documentElement.dataset.tvMode === 'true';
  const usePasswordPrototypeThree = desktopLayout && !tvMode;
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
  const passwordStrengthScore = [
    Array.from(newPassword).length >= MIN_ACCOUNT_PASSWORD_CHARACTERS,
    /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword),
    /\d/.test(newPassword),
    /[^A-Za-z0-9\s]/.test(newPassword)
  ].filter(Boolean).length;
  const passwordStrengthLabel = passwordStrengthScore >= 3 ? 'Forte' : passwordStrengthScore >= 2 ? 'Média' : 'Fraca';
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
        : view === 'apps'
          ? 'Apps e integrações'
          : view === 'playback'
            ? 'Reprodução'
            : view === 'data-import'
              ? 'Importar dados pessoais'
              : 'Minha conta';
  const subtitle = view === 'profile'
    ? 'Informações da conta'
    : view === 'password'
      ? 'Atualize sua senha de acesso'
      : view === 'sessions'
        ? 'Gerencie sessões em dispositivos'
        : view === 'apps'
          ? 'Chaves OpenSubsonic revogáveis'
          : view === 'playback'
            ? 'Qualidade e normalização'
            : view === 'data-import'
              ? 'Preview seguro antes de aplicar'
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
        <>
          <div className="my-account-overview my-account-overview--v3" data-testid="my-account-prototype-three">
            <section className="my-account-v3__hero" aria-labelledby="my-account-v3-title">
              <div className="my-account-v3__intro">
                <span className="my-account-v3__eyebrow">Minha conta</span>
                <h1 id="my-account-v3-title">Seu som,<br />suas escolhas.</h1>
                <p>Gerencie sua conta, defina suas preferências e mantenha tudo do seu jeito no Home Music.</p>
              </div>

              <button
                className="my-account-v3__profile-card"
                type="button"
                onClick={() => setView('profile')}
                aria-label={`Abrir perfil de ${currentUser.username}`}
              >
                <span className="my-account-v3__avatar" aria-hidden="true">
                  <img src="/account-v3-avatar.webp" alt="" />
                </span>
                <span className="my-account-v3__profile-copy">
                  <strong>{currentUser.username}</strong>
                  <small>{roleLabel}</small>
                  <span className="my-account-v3__active"><span /> Sessão ativa</span>
                </span>
                <span className="my-account-v3__quote" aria-hidden="true">
                  <em>“Música organiza<br />o caos.”</em>
                  <small>— Home Music</small>
                </span>
              </button>

              <div className="my-account-v3__headphones" aria-hidden="true" />
            </section>

            <section className="my-account-v3__settings" aria-labelledby="my-account-v3-settings-title">
              <header className="my-account-v3__settings-heading">
                <span className="my-account-v3__eyebrow">Configurações</span>
                <h2 id="my-account-v3-settings-title">O controle é seu</h2>
                <p>Tudo o que você precisa, em um só lugar.</p>
              </header>

              <span className="my-account-v3__aside-quote" aria-hidden="true">
                <em>Boa música<br />vai mais longe.</em>
                <i />
              </span>

              <div className="my-account-v3__grid">
                <button className="my-account-v3__card is-amber" type="button" onClick={() => setView('password')}>
                  <span className="my-account-v3__card-icon"><KeyRound /></span>
                  <span className="my-account-v3__card-copy">
                    <strong>Alterar senha</strong>
                    <small>Use sua senha atual para confirmar a mudança.</small>
                  </span>
                  <ChevronRight />
                </button>

                <button className="my-account-v3__card is-blue" type="button" onClick={() => setView('sessions')}>
                  <span className="my-account-v3__card-icon"><Monitor /></span>
                  <span className="my-account-v3__card-copy">
                    <strong>Outros dispositivos</strong>
                    <small>Encerre acessos antigos sem sair deste dispositivo.</small>
                  </span>
                  <ChevronRight />
                </button>

                <button className="my-account-v3__card is-violet" type="button" onClick={() => setView('apps')}>
                  <span className="my-account-v3__card-icon"><Link2 /></span>
                  <span className="my-account-v3__card-copy">
                    <strong>Apps e integrações</strong>
                    <small>Crie chaves separadas para clientes OpenSubsonic.</small>
                  </span>
                  <ChevronRight />
                </button>

                <button className="my-account-v3__card is-green" type="button" onClick={() => setView('data-import')}>
                  <span className="my-account-v3__card-icon"><CloudUpload /></span>
                  <span className="my-account-v3__card-copy">
                    <strong>Importar dados pessoais</strong>
                    <small>Revise um bundle exportado antes de restaurar dados na sua conta.</small>
                  </span>
                  <ChevronRight />
                </button>

                {playbackPreferences ? (
                  <button className="my-account-v3__card is-pink" type="button" onClick={() => setView('playback')}>
                    <span className="my-account-v3__card-icon"><SlidersHorizontal /></span>
                    <span className="my-account-v3__card-copy">
                      <strong>Reprodução</strong>
                      <small>Qualidade, conexão e normalização.</small>
                    </span>
                    <ChevronRight />
                  </button>
                ) : <span className="my-account-v3__card-spacer" aria-hidden="true" />}

                {offlineMode ? (
                  <button
                    className="my-account-v3__card is-cyan"
                    type="button"
                    disabled={!offlineModeAvailable}
                    aria-disabled={!offlineModeAvailable}
                    onClick={offlineModeAvailable ? offlineMode.onOpen : undefined}
                  >
                    <span className="my-account-v3__card-icon"><WifiOff /></span>
                    <span className="my-account-v3__card-copy">
                      <strong>Modo offline</strong>
                      <small>{offlineModeDetail}</small>
                    </span>
                    <ChevronRight />
                  </button>
                ) : <span className="my-account-v3__card-spacer" aria-hidden="true" />}
              </div>

              <div className="my-account-v3__bottom-grid">
                {currentUser.role === 'admin' && (
                  <button className="my-account-v3__card my-account-v3__card--wide is-indigo" type="button" onClick={onOpenAdministration}>
                    <span className="my-account-v3__card-icon"><ShieldCheck /></span>
                    <span className="my-account-v3__card-copy">
                      <strong>Administração</strong>
                      <small>Usuários e controles do Home Music.</small>
                    </span>
                    <ChevronRight />
                  </button>
                )}

                <button
                  className="my-account-v3__card my-account-v3__card--wide my-account-v3__card--danger is-red"
                  type="button"
                  disabled={signingOut}
                  onClick={() => void signOut()}
                >
                  <span className="my-account-v3__card-icon">
                    {signingOut ? <LoaderCircle className="my-account-spinner" /> : <LogOut />}
                  </span>
                  <span className="my-account-v3__card-copy">
                    <strong>{signingOut ? 'Saindo…' : 'Sair da conta'}</strong>
                    <small>Encerre sua sessão neste dispositivo.</small>
                  </span>
                  <ChevronRight />
                </button>
              </div>

              <footer className="my-account-v3__footer" aria-hidden="true">
                <span>Home Music&nbsp;&nbsp;•&nbsp;&nbsp;Música para uma vida mais sua.</span>
                <span>Ouça&nbsp;&nbsp;•&nbsp;&nbsp;Organize&nbsp;&nbsp;•&nbsp;&nbsp;Viva melhor <i /></span>
              </footer>
            </section>
          </div>

          <div className="my-account-overview my-account-overview--legacy">
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
              <button type="button" onClick={() => setView('apps')}>
                <span className="my-account-card__icon"><KeyRound /></span>
                <span><strong>Apps e integrações</strong><small>Crie chaves separadas para clientes OpenSubsonic.</small></span>
                <ChevronRight />
              </button>
            </div>
          </section>

          <section className="my-account-link-group" aria-labelledby="my-account-group-data">
            <span className="my-account-link-group__label" id="my-account-group-data">Dados</span>
            <div className="my-account-links">
              <button type="button" onClick={() => setView('data-import')}>
                <span className="my-account-card__icon"><Upload /></span>
                <span><strong>Importar dados pessoais</strong><small>Revise um bundle exportado antes de restaurar dados na sua conta.</small></span>
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
        </>
      )}

      {view === 'profile' && (
        <>
          <div className="my-account-profile-v1" data-testid="my-account-profile-prototype-one">
            <section className="my-account-profile-v1__hero" aria-labelledby="my-account-profile-v1-title">
              <button className="my-account-profile-v1__back" type="button" onClick={goBack}>
                <ChevronLeft />
                <span>Minha conta</span>
              </button>

              <div className="my-account-profile-v1__intro">
                <h1 id="my-account-profile-v1-title">Seu perfil</h1>
                <p>Suas informações, do seu jeito.</p>
              </div>

              <div className="my-account-profile-v1__headphones" aria-hidden="true" />
              <span className="my-account-profile-v1__quote" aria-hidden="true">
                <strong>Boa música</strong>
                <span>vai mais longe.</span>
              </span>
            </section>

            <section className="my-account-profile-v1__identity" aria-labelledby="my-account-profile-v1-name">
              <span className="my-account-profile-v1__avatar" aria-hidden="true"><UserRound /></span>
              <div className="my-account-profile-v1__identity-copy">
                <strong id="my-account-profile-v1-name">{currentUser.username}</strong>
                <span>{roleLabel}</span>
              </div>
              <span className="my-account-profile-v1__status"><ShieldCheck /> Sessão ativa</span>
            </section>

            <section className="my-account-profile-v1__details" aria-labelledby="my-account-profile-v1-details-title">
              <header className="my-account-profile-v1__section-heading">
                <span className="my-account-profile-v1__section-icon"><UserRound /></span>
                <div>
                  <strong id="my-account-profile-v1-details-title">Informações da conta</strong>
                  <small>Seus dados básicos no Home Music.</small>
                </div>
              </header>

              <div className="my-account-profile-v1__rows">
                <div className="my-account-profile-v1__row">
                  <span className="my-account-profile-v1__row-icon"><UserRound /></span>
                  <span className="my-account-profile-v1__row-copy">
                    <strong>Nome de usuário</strong>
                    <small>Seu identificador na aplicação.</small>
                  </span>
                  <span className="my-account-profile-v1__row-value">{currentUser.username}</span>
                  <span className="my-account-profile-v1__row-action" aria-hidden="true"><Pencil /> Editar</span>
                </div>

                <div className="my-account-profile-v1__row">
                  <span className="my-account-profile-v1__row-icon"><UserRound /></span>
                  <span className="my-account-profile-v1__row-copy">
                    <strong>Tipo de conta</strong>
                    <small>Seu nível de acesso e permissões.</small>
                  </span>
                  <span className="my-account-profile-v1__row-value">{roleLabel}</span>
                  <span className="my-account-profile-v1__row-action" aria-hidden="true"><ShieldCheck /> Detalhes</span>
                </div>
              </div>
            </section>

            <section className="my-account-profile-v1__security-section" aria-labelledby="my-account-profile-v1-security-title">
              <header className="my-account-profile-v1__section-heading">
                <span className="my-account-profile-v1__section-icon my-account-profile-v1__section-icon--security"><ShieldCheck /></span>
                <div>
                  <strong id="my-account-profile-v1-security-title">Segurança da conta</strong>
                  <small>Mantenha sua conta segura.</small>
                </div>
              </header>

              <div className="my-account-profile-v1__security">
                <span className="my-account-profile-v1__security-icon"><ShieldCheck /></span>
                <span className="my-account-profile-v1__security-copy">
                  <strong>Sua conta está protegida</strong>
                  <small>Use uma senha exclusiva e encerre sessões que você não reconhecer.</small>
                </span>
                <button className="my-account-profile-v1__security-action" type="button" onClick={() => setView('password')}>
                  <KeyRound />
                  <span>Alterar senha</span>
                </button>
              </div>
            </section>

            <footer className="my-account-profile-v1__footer">
              <span className="my-account-profile-v1__footer-title"><AudioLines /> O controle é seu.</span>
              <small>Gerencie suas informações com segurança e continue curtindo sua música.</small>
            </footer>
          </div>

          <div className="my-account-profile-page my-account-profile-page--legacy">
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
        </>
      )}

      {view === 'password' && (
        usePasswordPrototypeThree ? (
          <div className="my-account-password-v3" data-testid="my-account-password-prototype-three">
            <header className="my-account-password-v3__topbar">
              <button className="my-account-password-v3__back" type="button" onClick={goBack}>
                <ChevronLeft />
                <span>Minha conta</span>
              </button>
              <span className="my-account-password-v3__help" aria-label="Ajuda">
                <CircleHelp />
                <span>Ajuda</span>
              </span>
            </header>

            <main className="my-account-password-v3__content">
              <section className="my-account-password-v3__intro" aria-labelledby="my-account-password-v3-title">
                <span className="my-account-password-v3__lock" aria-hidden="true"><LockKeyhole /></span>
                <h1 id="my-account-password-v3-title">Alterar senha</h1>
                <p>Escolha uma nova senha forte e segura.</p>
              </section>

              <form id="my-account-password-v3-form" className="my-account-password-v3__form-card" onSubmit={submitPassword}>
                <label>
                  <span>Senha atual</span>
                  <span className="my-account-password-v3__field">
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Digite sua senha atual"
                      value={currentPassword}
                      disabled={changingPassword}
                      onChange={event => setCurrentPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={showPasswords ? 'Ocultar senha atual' : 'Mostrar senha atual'}
                      aria-pressed={showPasswords}
                      disabled={changingPassword}
                      onClick={() => setShowPasswords(value => !value)}
                    >
                      {showPasswords ? <EyeOff /> : <Eye />}
                    </button>
                  </span>
                </label>

                <label>
                  <span>Nova senha</span>
                  <span className="my-account-password-v3__field">
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Digite sua nova senha"
                      value={newPassword}
                      disabled={changingPassword}
                      onChange={event => setNewPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={showPasswords ? 'Ocultar nova senha' : 'Mostrar nova senha'}
                      aria-pressed={showPasswords}
                      disabled={changingPassword}
                      onClick={() => setShowPasswords(value => !value)}
                    >
                      {showPasswords ? <EyeOff /> : <Eye />}
                    </button>
                  </span>
                </label>

                <div className="my-account-password-v3__strength" aria-live="polite">
                  <span>Força da senha</span>
                  <strong>{passwordStrengthLabel}</strong>
                  <div className="my-account-password-v3__strength-bars" aria-hidden="true">
                    {[1, 2, 3, 4].map(level => (
                      <i key={level} className={passwordStrengthScore >= level ? 'is-active' : ''} />
                    ))}
                  </div>
                  <small>
                    {passwordStrengthScore >= 3
                      ? 'Ótimo! Sua senha está forte.'
                      : 'Combine letras, números e símbolos para fortalecer sua senha.'}
                  </small>
                </div>

                <label>
                  <span>Confirmar nova senha</span>
                  <span className="my-account-password-v3__field">
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Digite novamente sua nova senha"
                      value={confirmation}
                      disabled={changingPassword}
                      onChange={event => setConfirmation(event.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={showPasswords ? 'Ocultar confirmação da senha' : 'Mostrar confirmação da senha'}
                      aria-pressed={showPasswords}
                      disabled={changingPassword}
                      onClick={() => setShowPasswords(value => !value)}
                    >
                      {showPasswords ? <EyeOff /> : <Eye />}
                    </button>
                  </span>
                </label>

                {(currentPassword || newPassword || confirmation) && validationError && (
                  <small className="my-account-password-v3__hint">{validationError}</small>
                )}
              </form>

              <section className="my-account-password-v3__tips" aria-labelledby="my-account-password-v3-tips-title">
                <span className="my-account-password-v3__tips-icon" aria-hidden="true"><Lightbulb /></span>
                <div>
                  <strong id="my-account-password-v3-tips-title">Dicas para uma senha segura</strong>
                  <span><CheckCircle2 /> Use pelo menos {MIN_ACCOUNT_PASSWORD_CHARACTERS} caracteres</span>
                  <span><CheckCircle2 /> Combine letras, números e símbolos</span>
                  <span><CheckCircle2 /> Evite informações pessoais óbvias</span>
                </div>
              </section>

              <button
                className="my-account-password-v3__submit"
                type="submit"
                form="my-account-password-v3-form"
                disabled={changingPassword || Boolean(validationError)}
              >
                {changingPassword ? <LoaderCircle className="my-account-spinner" /> : <LockKeyhole />}
                <span>{changingPassword ? 'Alterando…' : 'Alterar senha'}</span>
              </button>

              <footer className="my-account-password-v3__protected">
                <ShieldCheck />
                <span>
                  <strong>Suas informações estão protegidas</strong>
                  <small>Usamos criptografia para manter sua conta segura.</small>
                </span>
              </footer>
            </main>
          </div>
        ) : (
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
        )
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

      {view === 'apps' && <AccountOpenSubsonicKeys />}

      {view === 'playback' && playbackPreferences && (
        <AccountPlaybackPreferences value={playbackPreferences} />
      )}

      {view === 'data-import' && <AccountPersonalDataImport />}
    </section>
  );
}
