import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminUser, AuthenticatedUser, UserRole } from '@home-music/shared';
import {
  CalendarDays,
  CheckCircle2,
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
  ShieldCheck,
  Trash2,
  UserRound,
  X
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

function roleLabel(role: UserRole) {
  return role === 'admin' ? 'Administrador' : 'Usuário';
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
  const selectedIsSelf = selected?.id === currentUser.id;
  const canManageSelected = Boolean(selected && canManageAdminTarget(currentUser.id, selected.id));

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

  useEffect(() => {
    if (view !== 'list' || selectedId || users.length === 0) return;
    setSelectedId(users.find(user => user.id === currentUser.id)?.id ?? users[0]?.id ?? null);
  }, [currentUser.id, selectedId, users, view]);

  async function refresh(background = false) {
    if (background) setRefreshing(true); else setLoading(true);
    try {
      setUsers(await listAdminUsers());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  function resetTransientState() {
    setCredential(null);
    setCopied(false);
    setBusy(false);
    setError(null);
    setNotice(null);
  }

  function openCreate() {
    setUsername('');
    setRole('user');
    setEnabled(true);
    resetTransientState();
    setView('create');
  }

  function inspectUser(user: AdminUser) {
    setSelectedId(user.id);
    setCredential(null);
    setCopied(false);
    setError(null);
    setNotice(null);
  }

  function openEdit(user: AdminUser) {
    if (!canManageAdminTarget(currentUser.id, user.id)) return;
    setSelectedId(user.id);
    setUsername(user.username);
    setRole(user.role);
    setEnabled(user.enabled);
    resetTransientState();
    setView('edit');
  }

  function returnToList() {
    setView('list');
    setCredential(null);
    setCopied(false);
    setBusy(false);
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
      setSelectedId(result.user.id);
      setCredential({ username: result.user.username, password: result.temporaryPassword, reason: 'created' });
      setCopied(false);
    } catch (caught) {
      setError(errorMessage(caught));
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!selected || !canManageSelected || busy) return;
    if (!window.confirm(`Gerar uma nova senha temporária para ${selected.username}? As sessões atuais serão encerradas.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resetAdminUserPassword(selected.id);
      setUsers(items => replaceUser(items, result.user));
      setCredential({ username: result.user.username, password: result.temporaryPassword, reason: 'reset' });
      setCopied(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function revokeSessions() {
    if (!selected || !canManageSelected || busy) return;
    if (!window.confirm(`Revogar todas as sessões de ${selected.username}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await revokeAdminUserSessions(selected.id);
      setNotice(`${result.revokedSessions} ${result.revokedSessions === 1 ? 'sessão encerrada' : 'sessões encerradas'}.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeUser() {
    if (!selected || !canManageSelected || busy) return;
    if (!window.confirm(`Remover ${selected.username}? A conta e os dados pessoais associados serão excluídos.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminUser(selected.id);
      setUsers(items => items.filter(user => user.id !== selected.id));
      setSelectedId(null);
      returnToList();
    } catch (caught) {
      setError(errorMessage(caught));
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
  const subtitle = view === 'create'
    ? 'Crie uma conta e compartilhe a senha temporária com segurança'
    : view === 'edit'
      ? 'Gerencie acesso, segurança e estado da conta'
      : 'Gerencie usuários e permissões';

  const credentialCard = credential ? (
    <div className="admin-users-v1__credential" role="status">
      <div className="admin-users-v1__credential-heading">
        <span className="admin-users-v1__credential-icon"><KeyRound /></span>
        <div>
          <strong>{credential.reason === 'created' ? `Conta criada · ${credential.username}` : `Senha redefinida · ${credential.username}`}</strong>
          <span>Copie a senha temporária agora. Ela não poderá ser recuperada depois.</span>
        </div>
      </div>
      <code>{credential.password}</code>
      <div className="admin-users-v1__credential-actions">
        <button type="button" onClick={() => void copyCredential()}><Copy /> {copied ? 'Copiada' : 'Copiar senha'}</button>
        <button type="button" onClick={() => { setCredential(null); setCopied(false); }}>Dispensar</button>
      </div>
    </div>
  ) : null;

  return (
    <section className={`admin-users-screen admin-users-screen--v1 admin-users-screen--${view}`} aria-labelledby="admin-users-title">
      <header className="admin-users-header admin-users-v1__header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={view === 'list' ? onBack : returnToList}><ChevronLeft /></button>
        <div><strong id="admin-users-title">{title}</strong><small>{subtitle}</small></div>
        {view === 'list' ? (
          <button className={`icon-button ${refreshing ? 'is-loading' : ''}`} type="button" aria-label="Atualizar usuários" disabled={loading || refreshing} onClick={() => void refresh(true)}><RefreshCw /></button>
        ) : <span className="admin-users-header__spacer" />}
      </header>

      {view !== 'list' && credentialCard}
      {error && <div className="admin-users-message is-error" role="alert">{error}</div>}
      {notice && <div className="admin-users-message" role="status">{notice}</div>}

      {view === 'list' && (
        <div className={`admin-users-v1__workspace${selected ? ' has-inspector' : ''}`}>
          <div className="admin-users-v1__list-column">
            <div className="admin-users-toolbar admin-users-v1__toolbar">
              <button className="admin-users-new" type="button" onClick={openCreate}><Plus /> Novo usuário</button>
              <label className="admin-users-search"><Search /><input aria-label="Buscar usuário" placeholder="Buscar usuário..." value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
              <select aria-label="Filtrar por papel" value={roleFilter} onChange={event => { setRoleFilter(event.target.value as RoleFilter); setPage(1); }}><option value="all">Papel: Todos</option><option value="admin">Administradores</option><option value="user">Usuários</option></select>
            </div>

            {loading ? <div className="admin-users-loading"><LoaderCircle className="admin-users-spinner" /> Carregando usuários…</div> : (
              <div className="admin-users-table-shell admin-users-v1__table-shell">
                <div className="admin-users-table-count">{filteredUsers.length} {filteredUsers.length === 1 ? 'usuário' : 'usuários'}</div>
                <table className="admin-users-table">
                  <thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Criado em</th><th>Ações</th></tr></thead>
                  <tbody>{visibleUsers.map(user => {
                    const self = user.id === currentUser.id;
                    const isSelected = selectedId === user.id;
                    return (
                      <tr key={user.id} className={`${!user.enabled ? 'is-disabled ' : ''}${isSelected ? 'is-selected' : ''}`}>
                        <td><span className="admin-users-user"><span className="admin-users-avatar"><UserRound /></span><strong>{user.username}{self ? ' (você)' : ''}</strong></span></td>
                        <td>{roleLabel(user.role)}</td>
                        <td><span className={`admin-user-status ${user.enabled ? 'is-active' : ''}`}>{user.enabled ? 'Ativo' : 'Inativo'}</span></td>
                        <td>{formatDate(user.createdAt)}</td>
                        <td><button className="admin-users-row-action" type="button" aria-label={`Ver detalhes de ${user.username}`} aria-pressed={isSelected} onClick={() => inspectUser(user)}><MoreHorizontal /></button></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                {!visibleUsers.length && <div className="admin-users-empty">Nenhum usuário encontrado.</div>}
                <div className="admin-users-pagination"><span>Mostrando {visibleUsers.length} de {filteredUsers.length} usuários</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button><span>{page}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight /></button></div></div>
              </div>
            )}
          </div>

          {selected && (
            <aside className="admin-users-v1__inspector" aria-label={`Detalhes de ${selected.username}`}>
              <header className="admin-users-v1__inspector-header">
                <div><strong>Detalhes do usuário</strong><small>Conta selecionada</small></div>
                <button type="button" aria-label="Fechar detalhes" onClick={() => setSelectedId(null)}><X /></button>
              </header>

              <div className="admin-users-v1__identity">
                <span className="admin-users-v1__identity-avatar"><UserRound /></span>
                <div>
                  <strong>{selected.username}{selectedIsSelf ? ' (você)' : ''}</strong>
                  <div className="admin-users-v1__badges">
                    <span>{roleLabel(selected.role)}</span>
                    <span className={selected.enabled ? 'is-active' : ''}>{selected.enabled ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </div>
              </div>

              {view === 'list' && credential && credential.username === selected.username && credentialCard}
              {notice && <div className="admin-users-v1__inline-notice" role="status"><CheckCircle2 /> {notice}</div>}

              <dl className="admin-users-v1__facts">
                <div><dt><ShieldCheck /> Papel</dt><dd>{roleLabel(selected.role)}</dd></div>
                <div><dt><CalendarDays /> Criado em</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                <div><dt><RefreshCw /> Atualizado em</dt><dd>{formatDate(selected.updatedAt)}</dd></div>
                <div><dt><KeyRound /> Senha</dt><dd>{selected.passwordMustChange ? 'Troca obrigatória no próximo acesso' : selected.passwordChangedAt ? `Alterada em ${formatDate(selected.passwordChangedAt)}` : 'Ainda não alterada'}</dd></div>
              </dl>

              {selectedIsSelf ? (
                <div className="admin-users-v1__self-note">
                  <UserRound />
                  <span>Esta é sua conta atual. Use <strong>Minha conta</strong> para ajustes pessoais.</span>
                </div>
              ) : (
                <section className="admin-users-v1__quick-actions" aria-label="Ações rápidas do usuário">
                  <strong>Ações rápidas</strong>
                  <button type="button" disabled={busy} onClick={() => openEdit(selected)}><UserRound /><span><strong>Editar usuário</strong><small>Alterar nome, papel e status.</small></span></button>
                  <button type="button" disabled={busy} onClick={() => void resetPassword()}><KeyRound /><span><strong>Redefinir senha</strong><small>Gerar uma nova senha temporária.</small></span></button>
                  <button type="button" disabled={busy} onClick={() => void revokeSessions()}><LogOut /><span><strong>Revogar sessões</strong><small>Encerrar todos os acessos atuais.</small></span></button>
                </section>
              )}
            </aside>
          )}
        </div>
      )}

      {view === 'create' && (
        <form className="admin-users-v1__focus admin-users-v1__create" onSubmit={createUser}>
          <section className="admin-users-v1__form-card">
            <div className="admin-users-v1__section-heading">
              <span className="admin-users-v1__section-icon"><UserRound /></span>
              <div><strong>Informações do usuário</strong><small>Defina a identificação e o nível de acesso da nova conta.</small></div>
            </div>
            <label><span>Nome de usuário</span><input autoFocus value={username} maxLength={120} placeholder="ex.: maria" onChange={event => setUsername(event.target.value)} /></label>
            <label><span>Papel</span><select value={role} onChange={event => setRole(event.target.value as UserRole)}><option value="user">Usuário</option><option value="admin">Administrador</option></select><small>Administradores podem gerenciar biblioteca, usuários e configurações administrativas.</small></label>
          </section>

          <aside className="admin-users-v1__create-security">
            <span className="admin-users-v1__section-icon"><KeyRound /></span>
            <div><strong>Senha temporária automática</strong><p>Uma senha segura será gerada ao criar a conta e exibida uma única vez para você copiar.</p></div>
            <div className="admin-users-v1__security-note"><ShieldCheck /><span>O usuário deverá trocar essa senha conforme as regras de segurança da conta.</span></div>
          </aside>

          <div className="admin-users-v1__focus-footer">
            <button type="button" onClick={returnToList}>Cancelar</button>
            <button className="primary-action" type="submit" disabled={busy || !username.trim()}>{busy ? 'Criando…' : 'Criar usuário'}</button>
          </div>
        </form>
      )}

      {view === 'edit' && selected && (
        <form className="admin-users-v1__focus admin-users-v1__edit" onSubmit={saveUser}>
          <section className="admin-users-v1__edit-summary">
            <span className="admin-users-v1__identity-avatar"><UserRound /></span>
            <div>
              <strong>{selected.username}</strong>
              <span>{roleLabel(selected.role)} · {selected.enabled ? 'Ativo' : 'Inativo'}</span>
              <small>Criado em {formatDate(selected.createdAt)}</small>
            </div>
          </section>

          <section className="admin-users-v1__form-card">
            <div className="admin-users-v1__section-heading">
              <span className="admin-users-v1__section-icon"><UserRound /></span>
              <div><strong>Informações da conta</strong><small>Alterações salvas encerram as sessões anteriores deste usuário.</small></div>
            </div>
            <label><span>Nome de usuário</span><input value={username} maxLength={120} onChange={event => setUsername(event.target.value)} /></label>
            <div className="admin-users-v1__field-grid">
              <label><span>Papel</span><select value={role} onChange={event => setRole(event.target.value as UserRole)}><option value="user">Usuário</option><option value="admin">Administrador</option></select><small>Define o nível de acesso.</small></label>
              <label><span>Status</span><select value={enabled ? 'active' : 'inactive'} onChange={event => setEnabled(event.target.value === 'active')}><option value="active">Ativo</option><option value="inactive">Inativo</option></select><small>Contas inativas não conseguem entrar.</small></label>
            </div>
          </section>

          <aside className="admin-users-v1__edit-actions">
            <section>
              <div className="admin-users-v1__section-heading compact"><span className="admin-users-v1__section-icon"><ShieldCheck /></span><div><strong>Segurança</strong><small>Ações imediatas sobre o acesso desta conta.</small></div></div>
              <button type="button" disabled={busy} onClick={() => void resetPassword()}><KeyRound /><span><strong>Redefinir senha</strong><small>Gerar uma nova senha temporária.</small></span></button>
              <button type="button" disabled={busy} onClick={() => void revokeSessions()}><LogOut /><span><strong>Revogar sessões</strong><small>Encerrar todos os acessos atuais.</small></span></button>
            </section>
            <section className="admin-users-v1__danger-zone">
              <div><strong>Zona de perigo</strong><small>A remoção da conta não pode ser desfeita.</small></div>
              <button type="button" disabled={busy} onClick={() => void removeUser()}><Trash2 /> Remover usuário</button>
            </section>
          </aside>

          <div className="admin-users-v1__focus-footer">
            <button type="button" onClick={returnToList}>Cancelar</button>
            <button className="primary-action" type="submit" disabled={busy || !username.trim()}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
