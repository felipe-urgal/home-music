import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminUser, AuthenticatedUser, UserRole } from '@home-music/shared';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
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
  const [inspectorDismissed, setInspectorDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const activeUsers = users.filter(user => user.enabled).length;

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (selectedId && !users.some(user => user.id === selectedId)) setSelectedId(null);
  }, [selectedId, users]);

  useEffect(() => {
    if (view !== 'list' || inspectorDismissed || selectedId || users.length === 0) return;
    setSelectedId(users.find(user => user.id === currentUser.id)?.id ?? users[0]?.id ?? null);
  }, [currentUser.id, inspectorDismissed, selectedId, users, view]);

  async function loadUsers() {
    setLoading(true);
    try {
      setUsers(await listAdminUsers());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  function canDiscardCredential() {
    return !credential || copied || window.confirm(
      'A senha temporária ainda não foi copiada. Continuar fará com que ela deixe de ser exibida. Deseja continuar?'
    );
  }

  function resetTransientState() {
    setCredential(null);
    setCopied(false);
    setBusy(false);
    setError(null);
    setNotice(null);
  }

  function openCreate() {
    if (!canDiscardCredential()) return;
    setUsername('');
    setRole('user');
    setEnabled(true);
    resetTransientState();
    setView('create');
  }

  function inspectUser(user: AdminUser) {
    if (user.id === selectedId) return;
    if (!canDiscardCredential()) return;
    setInspectorDismissed(false);
    setSelectedId(user.id);
    setCredential(null);
    setCopied(false);
    setError(null);
    setNotice(null);
  }

  function closeInspector() {
    if (!canDiscardCredential()) return;
    setInspectorDismissed(true);
    setSelectedId(null);
    setCredential(null);
    setCopied(false);
    setNotice(null);
  }

  function openEdit(user: AdminUser) {
    if (!canManageAdminTarget(currentUser.id, user.id) || !canDiscardCredential()) return;
    setSelectedId(user.id);
    setUsername(user.username);
    setRole(user.role);
    setEnabled(user.enabled);
    resetTransientState();
    setView('edit');
  }

  function returnToList() {
    if (!canDiscardCredential()) return;
    setInspectorDismissed(false);
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
      setUsername('');
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
      setSelectedId(updated.id);
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
    if (!window.confirm(`Remover ${selected.username}? A conta será removida e suas sessões serão encerradas. Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminUser(selected.id);
      setUsers(items => items.filter(user => user.id !== selected.id));
      setSelectedId(null);
      setInspectorDismissed(false);
      setCredential(null);
      setCopied(false);
      setNotice(null);
      setView('list');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
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
    ? 'Crie uma conta para acessar o Home Music'
    : view === 'edit'
      ? 'Altere as informações e permissões'
      : 'Gerencie quem pode acessar o Home Music';

  if (view === 'create' && credential?.reason === 'created') {
    return (
      <section className="admin-users-screen admin-users-screen--v2 admin-users-screen--credential" aria-labelledby="admin-users-title">
        <header className="admin-users-v2__page-header">
          <button className="admin-users-v2__back" type="button" aria-label="Voltar" onClick={returnToList}><ChevronLeft /></button>
          <div>
            <strong id="admin-users-title">Conta criada</strong>
            <small>A conta foi criada com sucesso</small>
          </div>
          <span />
        </header>

        <div className="admin-users-v2__credential-screen admin-users-credential" role="status">
          <div className="admin-users-v2__credential-success"><Check /></div>
          <strong>Conta criada</strong>
          <small>{credential.username}</small>

          <div className="admin-users-v2__credential-block">
            <span>Senha temporária</span>
            <div>
              <code>{credential.password}</code>
              <button type="button" onClick={() => void copyCredential()}><Copy /> {copied ? 'Copiada' : 'Copiar'}</button>
            </div>
          </div>

          <div className="admin-users-v2__credential-note">
            <InfoIcon />
            <span>Esta senha será exibida apenas agora. Ela não poderá ser recuperada depois. O usuário deverá alterá-la no primeiro acesso.</span>
          </div>

          <button className="admin-users-v2__credential-done" type="button" onClick={returnToList}>Concluir</button>
        </div>
      </section>
    );
  }

  return (
    <section className={`admin-users-screen admin-users-screen--v2 admin-users-screen--${view}`} aria-labelledby="admin-users-title">
      <header className="admin-users-v2__page-header">
        <button className="admin-users-v2__back" type="button" aria-label="Voltar" onClick={view === 'list' ? onBack : returnToList}><ChevronLeft /></button>
        <div>
          <strong id="admin-users-title">{title}</strong>
          <small>{subtitle}</small>
        </div>
        {view === 'list' ? (
          <div className="admin-users-v2__summary">
            <span />
            <div>
              <strong>{users.length.toLocaleString('pt-BR')} {users.length === 1 ? 'usuário' : 'usuários'}</strong>
              <small>{activeUsers.toLocaleString('pt-BR')} ativos</small>
            </div>
          </div>
        ) : <span />}
      </header>

      {error && <div className="admin-users-message is-error" role="alert">{error}</div>}
      {view !== 'list' && notice && <div className="admin-users-message" role="status">{notice}</div>}

      {view === 'list' && (
        <div className="admin-users-v2">
          <section className="admin-users-v2__controls">
            <button className="admin-users-v2__new" type="button" onClick={openCreate}><Plus /> Novo usuário</button>
            <label className="admin-users-v2__search">
              <Search />
              <input
                aria-label="Buscar usuário"
                placeholder="Buscar usuário..."
                value={query}
                onChange={event => { setQuery(event.target.value); setPage(1); }}
              />
            </label>
          </section>

          <nav className="admin-users-v2__filters" aria-label="Filtrar usuários por papel">
            <button type="button" className={roleFilter === 'all' ? 'is-active' : ''} onClick={() => { setRoleFilter('all'); setPage(1); }}>Todos</button>
            <button type="button" className={roleFilter === 'admin' ? 'is-active' : ''} onClick={() => { setRoleFilter('admin'); setPage(1); }}>Administradores</button>
            <button type="button" className={roleFilter === 'user' ? 'is-active' : ''} onClick={() => { setRoleFilter('user'); setPage(1); }}>Usuários</button>
          </nav>

          {loading ? (
            <div className="admin-users-v2__loading"><LoaderCircle className="is-spinning" /> Carregando usuários…</div>
          ) : (
            <div className={`admin-users-v2__workspace${selected ? ' has-inspector' : ''}`}>
              <section className="admin-users-v2__list" aria-label="Usuários">
                {visibleUsers.length === 0 ? (
                  <div className="admin-users-v2__empty">
                    <UserRound />
                    <strong>Nenhum usuário encontrado</strong>
                    <span>Ajuste a busca ou o filtro.</span>
                  </div>
                ) : (
                  <div className="admin-users-v2__rows">
                    {visibleUsers.map(user => {
                      const self = user.id === currentUser.id;
                      const isSelected = selectedId === user.id;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          className={`admin-users-v2__row${isSelected ? ' is-selected' : ''}${!user.enabled ? ' is-disabled' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => inspectUser(user)}
                        >
                          <span className="admin-users-v2__avatar"><UserRound /></span>
                          <span className="admin-users-v2__row-copy">
                            <strong>{user.username}{self ? ' (você)' : ''}</strong>
                            <small>{roleLabel(user.role)}</small>
                          </span>
                          <span className={`admin-users-v2__status${user.enabled ? ' is-active' : ''}`}>
                            <i /> {user.enabled ? 'Ativo' : 'Inativo'}
                          </span>
                          <ChevronRight />
                        </button>
                      );
                    })}
                  </div>
                )}

                {pageCount > 1 && (
                  <footer className="admin-users-v2__pagination">
                    <span>Mostrando {visibleUsers.length} de {filteredUsers.length} usuários</span>
                    <div>
                      <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
                      <span>{page}</span>
                      <button type="button" aria-label="Próxima página" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
                    </div>
                  </footer>
                )}
              </section>

              {selected && (
                <aside className="admin-users-v2__inspector" aria-label={`Detalhes de ${selected.username}`}>
                  <header>
                    <div><strong>Detalhes do usuário</strong><small>Conta selecionada</small></div>
                    <button type="button" aria-label="Fechar detalhes" onClick={closeInspector}><X /></button>
                  </header>

                  <section className="admin-users-v2__identity">
                    <span className="admin-users-v2__identity-avatar"><UserRound /></span>
                    <div>
                      <strong>{selected.username}{selectedIsSelf ? ' (você)' : ''}</strong>
                      <div>
                        <span>{roleLabel(selected.role)}</span>
                        <span className={selected.enabled ? 'is-active' : ''}>{selected.enabled ? 'Ativo' : 'Inativo'}</span>
                      </div>
                    </div>
                  </section>

                  {credential && credential.username === selected.username && (
                    <div className="admin-users-v2__inline-credential admin-users-credential" role="status">
                      <strong>Nova senha temporária</strong>
                      <code>{credential.password}</code>
                      <button type="button" onClick={() => void copyCredential()}><Copy /> {copied ? 'Copiada' : 'Copiar senha'}</button>
                    </div>
                  )}

                  {notice && <div className="admin-users-v2__notice" role="status"><CheckCircle2 /> {notice}</div>}

                  <dl className="admin-users-v2__facts">
                    <div><dt><ShieldCheck /> Papel</dt><dd>{roleLabel(selected.role)}</dd></div>
                    <div><dt><CalendarDays /> Criado em</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                    <div><dt><CalendarDays /> Atualizado em</dt><dd>{formatDate(selected.updatedAt)}</dd></div>
                    <div><dt><KeyRound /> Senha</dt><dd>{selected.passwordMustChange ? 'Troca obrigatória no próximo acesso' : selected.passwordChangedAt ? `Alterada em ${formatDate(selected.passwordChangedAt)}` : 'Ainda não alterada'}</dd></div>
                  </dl>

                  {selectedIsSelf ? (
                    <div className="admin-users-v2__self-note">
                      <UserRound />
                      <span>Esta é sua conta atual. Senha, sessões e ajustes pessoais devem ser gerenciados em <strong>Minha conta</strong>.</span>
                    </div>
                  ) : (
                    <>
                      <section className="admin-users-v2__inspector-section">
                        <strong>Acesso</strong>
                        <button type="button" disabled={busy} onClick={() => openEdit(selected)}><UserRound /> Editar usuário</button>
                      </section>

                      <section className="admin-users-v2__inspector-section">
                        <strong>Segurança</strong>
                        <button type="button" disabled={busy} onClick={() => void resetPassword()}><KeyRound /> Redefinir senha</button>
                        <button type="button" disabled={busy} onClick={() => void revokeSessions()}><LogOut /> Revogar sessões</button>
                      </section>

                      <section className="admin-users-v2__danger-zone">
                        <strong>Zona de risco</strong>
                        <small>A remoção da conta não pode ser desfeita.</small>
                        <button type="button" disabled={busy} onClick={() => void removeUser()}><Trash2 /> Remover usuário</button>
                      </section>
                    </>
                  )}
                </aside>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'create' && (
        <form className="admin-users-v2__focus" onSubmit={createUser}>
          <section className="admin-users-v2__form-card">
            <div className="admin-users-v2__section-heading">
              <span><UserRound /></span>
              <div><strong>Informações da conta</strong><small>Defina quem vai acessar e com qual nível de permissão.</small></div>
            </div>

            <label>
              <span>Nome de usuário</span>
              <input autoFocus aria-label="Nome de usuário" value={username} maxLength={120} placeholder="ex.: maria" onChange={event => setUsername(event.target.value)} />
            </label>

            <label>
              <span>Papel</span>
              <select value={role} onChange={event => setRole(event.target.value as UserRole)}>
                <option value="user">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
              <small>Usuários acessam a biblioteca e os próprios dados. Administradores também gerenciam biblioteca e sistema.</small>
            </label>

            <div className="admin-users-v2__temporary-password">
              <KeyRound />
              <div>
                <strong>Senha temporária</strong>
                <p>Uma senha segura será criada automaticamente e exibida apenas uma vez.</p>
                <small>O usuário deverá alterá-la no primeiro acesso.</small>
              </div>
            </div>
          </section>

          <footer className="admin-users-v2__form-actions">
            <button type="button" onClick={returnToList}>Cancelar</button>
            <button className="is-primary" type="submit" disabled={busy || !username.trim()}>{busy ? 'Criando…' : 'Criar usuário'}</button>
          </footer>
        </form>
      )}

      {view === 'edit' && selected && (
        <form className="admin-users-v2__focus" onSubmit={saveUser}>
          <section className="admin-users-v2__form-card">
            <div className="admin-users-v2__section-heading">
              <span><UserRound /></span>
              <div><strong>Informações da conta</strong><small>{selected.username} · {roleLabel(selected.role)} · {selected.enabled ? 'Ativo' : 'Inativo'}</small></div>
            </div>

            <label>
              <span>Nome de usuário</span>
              <input autoFocus value={username} maxLength={120} onChange={event => setUsername(event.target.value)} />
            </label>

            <div className="admin-users-v2__field-grid">
              <label>
                <span>Papel</span>
                <select value={role} onChange={event => setRole(event.target.value as UserRole)}>
                  <option value="user">Usuário</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={enabled ? 'active' : 'inactive'} onChange={event => setEnabled(event.target.value === 'active')}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                </select>
              </label>
            </div>

            <small className="admin-users-v2__access-note">Alterações de acesso encerram as sessões atuais do usuário.</small>

            <section className="admin-users-v2__edit-security">
              <strong>Segurança</strong>
              <div>
                <button type="button" disabled={busy} onClick={() => void resetPassword()}><KeyRound /> Redefinir senha</button>
                <button type="button" disabled={busy} onClick={() => void revokeSessions()}><LogOut /> Revogar sessões</button>
              </div>
            </section>

            <section className="admin-users-v2__edit-danger">
              <strong>Zona de risco</strong>
              <button type="button" disabled={busy} onClick={() => void removeUser()}><Trash2 /> Remover usuário</button>
            </section>
          </section>

          <footer className="admin-users-v2__form-actions">
            <button type="button" onClick={returnToList}>Cancelar</button>
            <button className="is-primary" type="submit" disabled={busy || !username.trim()}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
          </footer>
        </form>
      )}
    </section>
  );
}

function InfoIcon() {
  return <ShieldCheck aria-hidden="true" />;
}
