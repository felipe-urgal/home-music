import { useEffect, useState, type FormEvent } from 'react';
import type { AdminUser, AuthenticatedUser, UserRole } from '@home-music/shared';
import {
  ChevronLeft,
  Copy,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  UserCheck,
  Users,
  UserX
} from 'lucide-react';
import {
  canManageAdminTarget,
  createAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  revokeAdminUserSessions,
  setAdminUserEnabled,
  setAdminUserRole
} from '../admin-users-client';

type AdminUsersScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
};

type TemporaryCredential = {
  username: string;
  password: string;
  reason: 'created' | 'reset';
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function replaceUser(users: AdminUser[], updated: AdminUser) {
  return users.map(user => user.id === updated.id ? updated : user);
}

export function AdminUsersScreen({ currentUser, onBack }: AdminUsersScreenProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [credential, setCredential] = useState<TemporaryCredential | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh(background = false) {
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      setUsers(await listAdminUsers());
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || creating) return;

    setCreating(true);
    setError(null);
    setNotice(null);
    setCredential(null);
    setCopied(false);
    try {
      const result = await createAdminUser(normalizedUsername, role);
      setUsers(items => [...items, result.user].sort((a, b) => a.username.localeCompare(b.username, 'pt-BR')));
      setUsername('');
      setRole('user');
      setCredential({ username: result.user.username, password: result.temporaryPassword, reason: 'created' });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(user: AdminUser, nextRole: UserRole) {
    if (nextRole === user.role || !canManageAdminTarget(currentUser.id, user.id)) return;
    if (!window.confirm(`Alterar ${user.username} para ${nextRole === 'admin' ? 'administrador' : 'usuário'}? As sessões atuais serão revogadas.`)) return;

    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await setAdminUserRole(user.id, nextRole);
      setUsers(items => replaceUser(items, updated));
      setNotice(`Papel de ${updated.username} atualizado.`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  }

  async function toggleEnabled(user: AdminUser) {
    if (!canManageAdminTarget(currentUser.id, user.id)) return;
    const nextEnabled = !user.enabled;
    if (!window.confirm(`${nextEnabled ? 'Ativar' : 'Desativar'} ${user.username}?${nextEnabled ? '' : ' As sessões atuais serão revogadas.'}`)) return;

    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await setAdminUserEnabled(user.id, nextEnabled);
      setUsers(items => replaceUser(items, updated));
      setNotice(`${updated.username} ${updated.enabled ? 'ativado' : 'desativado'}.`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  }

  async function resetPassword(user: AdminUser) {
    if (!canManageAdminTarget(currentUser.id, user.id)) return;
    if (!window.confirm(`Gerar uma nova senha temporária para ${user.username}? Todas as sessões atuais serão revogadas.`)) return;

    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    setCredential(null);
    setCopied(false);
    try {
      const result = await resetAdminUserPassword(user.id);
      setUsers(items => replaceUser(items, result.user));
      setCredential({ username: result.user.username, password: result.temporaryPassword, reason: 'reset' });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  }

  async function revokeSessions(user: AdminUser) {
    if (!canManageAdminTarget(currentUser.id, user.id)) return;
    if (!window.confirm(`Revogar todas as sessões atuais de ${user.username}?`)) return;

    setBusyUserId(user.id);
    setError(null);
    setNotice(null);
    try {
      const result = await revokeAdminUserSessions(user.id);
      setNotice(`${result.revokedSessions} ${result.revokedSessions === 1 ? 'sessão revogada' : 'sessões revogadas'} de ${user.username}.`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  }

  async function copyCredential() {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="admin-users-screen" aria-labelledby="admin-users-title">
      <header className="admin-users-header">
        <button className="icon-button" type="button" aria-label="Voltar à biblioteca" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-users-title">Usuários</strong>
          <small>{users.length} {users.length === 1 ? 'conta' : 'contas'}</small>
        </div>
        <button className={`icon-button ${refreshing ? 'is-loading' : ''}`} type="button" aria-label="Atualizar usuários" disabled={loading || refreshing} onClick={() => void refresh(true)}>
          <RefreshCw />
        </button>
      </header>

      <form className="admin-users-create" onSubmit={createUser}>
        <div className="admin-users-section-title">
          <span><Plus /> Nova conta</span>
          <small>Senha temporária gerada automaticamente</small>
        </div>
        <div className="admin-users-create__fields">
          <label>
            <span>Usuário</span>
            <input value={username} maxLength={120} autoComplete="off" placeholder="ex.: maria" onChange={event => setUsername(event.target.value)} />
          </label>
          <label>
            <span>Papel</span>
            <select value={role} onChange={event => setRole(event.target.value as UserRole)}>
              <option value="user">Usuário</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button className="primary-action admin-users-create__submit" type="submit" disabled={creating || !username.trim()}>
            {creating ? <LoaderCircle className="admin-users-spinner" /> : <Plus />}
            {creating ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
      </form>

      {credential && (
        <div className="admin-users-credential" role="status">
          <div>
            <strong>{credential.reason === 'created' ? 'Conta criada' : 'Senha redefinida'} · {credential.username}</strong>
            <span>Copie a senha temporária agora. Ela não poderá ser recuperada depois.</span>
          </div>
          <code>{credential.password}</code>
          <div className="admin-users-credential__actions">
            <button type="button" onClick={() => void copyCredential()}><Copy /> {copied ? 'Copiada' : 'Copiar senha'}</button>
            <button type="button" onClick={() => { setCredential(null); setCopied(false); }}>Dispensar</button>
          </div>
        </div>
      )}

      {error && <div className="admin-users-message is-error" role="alert">{error}</div>}
      {notice && <div className="admin-users-message" role="status">{notice}</div>}

      {loading ? (
        <div className="admin-users-loading"><LoaderCircle className="admin-users-spinner" /> Carregando usuários…</div>
      ) : users.length === 0 ? (
        <div className="admin-users-empty">Nenhuma conta encontrada.</div>
      ) : (
        <div className="admin-users-list">
          {users.map(user => {
            const self = !canManageAdminTarget(currentUser.id, user.id);
            const busy = busyUserId === user.id;
            return (
              <article className={`admin-user-card ${user.enabled ? '' : 'is-disabled'}`} key={user.id}>
                <div className="admin-user-card__identity">
                  <span className="admin-user-card__avatar"><Users /></span>
                  <div>
                    <strong>{user.username}{self ? ' · você' : ''}</strong>
                    <small>Criado em {formatDate(user.createdAt)}</small>
                  </div>
                  <span className={`admin-user-status ${user.enabled ? 'is-active' : ''}`}>{user.enabled ? 'Ativo' : 'Inativo'}</span>
                </div>

                <div className="admin-user-card__meta">
                  <span><Shield /> {user.role === 'admin' ? 'Administrador' : 'Usuário'}</span>
                  {user.passwordMustChange && <span><KeyRound /> Troca de senha pendente</span>}
                </div>

                {self ? (
                  <div className="admin-user-card__self">Gerencie sua própria senha e sessões pela futura tela Minha conta.</div>
                ) : (
                  <div className="admin-user-card__actions">
                    <label>
                      <span>Papel</span>
                      <select value={user.role} disabled={busy} onChange={event => void changeRole(user, event.target.value as UserRole)}>
                        <option value="user">Usuário</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </label>
                    <button type="button" disabled={busy} onClick={() => void toggleEnabled(user)}>
                      {user.enabled ? <UserX /> : <UserCheck />}{user.enabled ? 'Desativar' : 'Ativar'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void resetPassword(user)}><KeyRound /> Resetar senha</button>
                    <button type="button" disabled={busy} onClick={() => void revokeSessions(user)}><LogOut /> Revogar sessões</button>
                    {busy && <LoaderCircle className="admin-users-spinner admin-user-card__busy" aria-label="Operação em andamento" />}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
