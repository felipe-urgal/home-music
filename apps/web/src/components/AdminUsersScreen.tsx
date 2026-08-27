import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminUser, AuthenticatedUser, UserRole } from '@home-music/shared';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound
} from 'lucide-react';
import {
  canManageAdminTarget,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  revokeAdminUserSessions,
  updateAdminUser
} from '../admin-users-client';

type AdminView = 'list' | 'create' | 'edit';
type RoleFilter = 'all' | UserRole;

type AdminUsersScreenProps = {
  currentUser: AuthenticatedUser;
  onBack: () => void;
};

type TemporaryCredential = {
  username: string;
  password: string;
  reason: 'created' | 'reset';
};

const PAGE_SIZE = 8;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function replaceUser(users: AdminUser[], updated: AdminUser) {
  return users.map(user => user.id === updated.id ? updated : user);
}

export function AdminUsersScreen({ currentUser, onBack }: AdminUsersScreenProps) {
  const [view, setView] = useState<AdminView>('list');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credential, setCredential] = useState<TemporaryCredential | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [enabled, setEnabled] = useState(true);

  const selected = users.find(user => user.id === selectedId) ?? null;
  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return users.filter(user => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      return !normalized || user.username.toLocaleLowerCase('pt-BR').includes(normalized);
    });
  }, [query, roleFilter, users]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const visibleUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  async function refresh(background = false) {
    if (background) setRefreshing(true); else setLoading(true);
    try {
      setUsers(await listAdminUsers());
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  function openCreate() {
    setUsername('');
    setRole('user');
    setEnabled(true);
    setCredential(null);
    setError(null);
    setNotice(null);
    setView('create');
  }

  function openEdit(user: AdminUser) {
    if (!canManageAdminTarget(currentUser.id, user.id)) return;
    setSelectedId(user.id);
    setUsername(user.username);
    setRole(user.role);
    setEnabled(user.enabled);
    setCredential(null);
    setError(null);
    setNotice(null);
    setView('edit');
  }

  function leaveDetail() {
    setView('list');
    setSelectedId(null);
    setCredential(null);
    setError(null);
    setNotice(null);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createAdminUser(username.trim(), role);
      setUsers(items => [...items, result.user].sort((a, b) => a.username.localeCompare(b.username, 'pt-BR')));
      setCredential({ username: result.user.username, password: result.temporaryPassword, reason: 'created' });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !username.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateAdminUser(selected.id, username.trim(), role, enabled);
      setUsers(items => replaceUser(items, updated));
      setNotice('Alterações salvas. As sessões anteriores deste usuário foram encerradas.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!selected || busy) return;
    if (!window.confirm(`Gerar uma nova senha temporária para ${selected.username}? As sessões atuais serão encerradas.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resetAdminUserPassword(selected.id);
      setUsers(items => replaceUser(items, result.user));
      setCredential({ username: result.user.username, password: result.temporaryPassword, reason: 'reset' });
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function revokeSessions() {
    if (!selected || busy) return;
    if (!window.confirm(`Revogar todas as sessões de ${selected.username}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await revokeAdminUserSessions(selected.id);
      setNotice(`${result.revokedSessions} ${result.revokedSessions === 1 ? 'sessão encerrada' : 'sessões encerradas'}.`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeUser() {
    if (!selected || busy) return;
    if (!window.confirm(`Remover ${selected.username}? A conta e os dados pessoais associados serão excluídos.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminUser(selected.id);
      setUsers(items => items.filter(user => user.id !== selected.id));
      leaveDetail();
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
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

  const title = view === 'create' ? 'Novo usuário' : view === 'edit' ? 'Editar usuário' : 'Usuários';
  const subtitle = view === 'create' ? 'Crie um novo usuário' : view === 'edit' ? 'Altere as informações do usuário' : 'Gerencie usuários e permissões';

  return (
    <section className={`admin-users-screen admin-users-screen--${view}`} aria-labelledby="admin-users-title">
      <header className="admin-users-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={view === 'list' ? onBack : leaveDetail}><ChevronLeft /></button>
        <div><strong id="admin-users-title">{title}</strong><small>{subtitle}</small></div>
        {view === 'list' ? (
          <button className={`icon-button ${refreshing ? 'is-loading' : ''}`} type="button" aria-label="Atualizar usuários" disabled={loading || refreshing} onClick={() => void refresh(true)}><RefreshCw /></button>
        ) : <span className="admin-users-header__spacer" />}
      </header>

      {error && <div className="admin-users-message is-error" role="alert">{error}</div>}
      {notice && <div className="admin-users-message" role="status">{notice}</div>}
      {credential && (
        <div className="admin-users-credential" role="status">
          <div><strong>{credential.reason === 'created' ? 'Conta criada' : 'Senha redefinida'} · {credential.username}</strong><span>Copie a senha temporária agora. Ela não poderá ser recuperada depois.</span></div>
          <code>{credential.password}</code>
          <div><button type="button" onClick={() => void copyCredential()}><Copy /> {copied ? 'Copiada' : 'Copiar senha'}</button><button type="button" onClick={() => { setCredential(null); setCopied(false); }}>Dispensar</button></div>
        </div>
      )}

      {view === 'list' && (
        <>
          <div className="admin-users-toolbar">
            <button className="admin-users-new" type="button" onClick={openCreate}><Plus /> Novo usuário</button>
            <label className="admin-users-search"><Search /><input aria-label="Buscar usuário" placeholder="Buscar usuário..." value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
            <select aria-label="Filtrar por papel" value={roleFilter} onChange={event => { setRoleFilter(event.target.value as RoleFilter); setPage(1); }}><option value="all">Papel: Todos</option><option value="admin">Administradores</option><option value="user">Usuários</option></select>
          </div>

          {loading ? <div className="admin-users-loading"><LoaderCircle className="admin-users-spinner" /> Carregando usuários…</div> : (
            <div className="admin-users-table-shell">
              <div className="admin-users-table-count">{filteredUsers.length} {filteredUsers.length === 1 ? 'usuário' : 'usuários'}</div>
              <table className="admin-users-table">
                <thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Criado em</th><th>Ações</th></tr></thead>
                <tbody>{visibleUsers.map(user => {
                  const self = user.id === currentUser.id;
                  return (
                    <tr key={user.id} className={!user.enabled ? 'is-disabled' : ''}>
                      <td><span className="admin-users-user"><span className="admin-users-avatar"><UserRound /></span><strong>{user.username}{self ? ' (você)' : ''}</strong></span></td>
                      <td>{user.role === 'admin' ? 'Administrador' : 'Usuário'}</td>
                      <td><span className={`admin-user-status ${user.enabled ? 'is-active' : ''}`}>{user.enabled ? 'Ativo' : 'Inativo'}</span></td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>{self ? <span className="admin-users-no-action">—</span> : <button className="admin-users-row-action" type="button" aria-label={`Gerenciar ${user.username}`} onClick={() => openEdit(user)}><MoreHorizontal /></button>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              {!visibleUsers.length && <div className="admin-users-empty">Nenhum usuário encontrado.</div>}
              <div className="admin-users-pagination"><span>Mostrando {visibleUsers.length} de {filteredUsers.length} usuários</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><span>{page}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>
            </div>
          )}
        </>
      )}

      {view === 'create' && (
        <form className="admin-users-editor" onSubmit={createUser}>
          <section><strong>Informações do usuário</strong><label><span>Nome de usuário</span><input autoFocus value={username} maxLength={120} placeholder="ex.: maria" onChange={event => setUsername(event.target.value)} /></label><label><span>Papel</span><select value={role} onChange={event => setRole(event.target.value as UserRole)}><option value="user">Usuário</option><option value="admin">Administrador</option></select><small>Defina o nível de acesso deste usuário.</small></label><div className="admin-users-temporary"><div><strong>Senha temporária</strong><span>Gerar senha automaticamente</span><small>Uma senha segura será gerada e exibida ao salvar.</small></div><span className="admin-users-toggle is-on" aria-hidden="true" /></div></section>
          <div className="admin-users-editor__footer"><button type="button" onClick={leaveDetail}>Cancelar</button><button className="primary-action" type="submit" disabled={busy || !username.trim()}>{busy ? 'Criando…' : 'Criar usuário'}</button></div>
        </form>
      )}

      {view === 'edit' && selected && (
        <form className="admin-users-editor" onSubmit={saveUser}>
          <section><strong>Informações do usuário</strong><label><span>Nome de usuário</span><input value={username} maxLength={120} onChange={event => setUsername(event.target.value)} /></label><label><span>Papel</span><select value={role} onChange={event => setRole(event.target.value as UserRole)}><option value="user">Usuário</option><option value="admin">Administrador</option></select><small>Defina o nível de acesso deste usuário.</small></label><label><span>Status</span><select value={enabled ? 'active' : 'inactive'} onChange={event => setEnabled(event.target.value === 'active')}><option value="active">Ativo</option><option value="inactive">Inativo</option></select><small>Usuários inativos não conseguem entrar na aplicação.</small></label></section>
          <section className="admin-users-editor__security"><strong>Ações do usuário</strong><button type="button" disabled={busy} onClick={() => void resetPassword()}><KeyRound /><span><strong>Redefinir senha</strong><small>Gerar uma nova senha temporária.</small></span></button><button type="button" disabled={busy} onClick={() => void revokeSessions()}><LogOut /><span><strong>Revogar sessões</strong><small>Encerrar todos os acessos deste usuário.</small></span></button></section>
          <div className="admin-users-editor__footer"><button type="button" onClick={leaveDetail}>Cancelar</button><button className="primary-action" type="submit" disabled={busy || !username.trim()}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>
          <button className="admin-users-delete" type="button" disabled={busy} onClick={() => void removeUser()}><Trash2 /> Remover usuário</button>
        </form>
      )}
    </section>
  );
}
