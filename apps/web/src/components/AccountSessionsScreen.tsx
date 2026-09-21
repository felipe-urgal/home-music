import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Info,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  TimerReset
} from 'lucide-react';
import type { AccountSession } from '../account-client';

type AccountSessionsScreenProps = {
  sessions: AccountSession[];
  loading: boolean;
  busySessionId: string | null;
  revokingAll: boolean;
  prototypeTwo?: boolean;
  onRefresh?: () => void;
  onRevokeOne: (session: AccountSession) => void;
  onRevokeOthers: () => void;
};

const PERSISTENT_SESSION_YEAR = 9999;

function formatSessionDate(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatSessionExpiration(value: number) {
  return new Date(value).getUTCFullYear() >= PERSISTENT_SESSION_YEAR
    ? 'Não expira'
    : formatSessionDate(value);
}

function formatSessionAge(value: number) {
  const diff = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

export function AccountSessionsScreen({
  sessions,
  loading,
  busySessionId,
  revokingAll,
  prototypeTwo = false,
  onRefresh,
  onRevokeOne,
  onRevokeOthers
}: AccountSessionsScreenProps) {
  const orderedSessions = [...sessions].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return right.lastSeenAt - left.lastSeenAt;
  });
  const otherSessions = orderedSessions.filter(session => !session.current);
  const otherSessionPosition = new Map(otherSessions.map((session, index) => [session.id, index + 1]));
  const [filter, setFilter] = useState<'all' | 'current' | 'others'>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const visibleSessions = filter === 'current'
    ? orderedSessions.filter(session => session.current)
    : filter === 'others'
      ? otherSessions
      : orderedSessions;
  const preferredSession = selectedSessionId
    ? visibleSessions.find(session => session.id === selectedSessionId)
    : undefined;
  const selectedSession = preferredSession
    ?? (filter === 'current' ? visibleSessions.find(session => session.current) : undefined)
    ?? visibleSessions[0]
    ?? null;
  const selectedPosition = selectedSession ? otherSessionPosition.get(selectedSession.id) : undefined;
  const selectedTitle = !selectedSession
    ? ''
    : selectedSession.current
      ? 'Este dispositivo'
      : `Outra sessão ${selectedPosition ?? ''}`.trim();

  if (prototypeTwo) {
    return (
      <div className="account-sessions-v2" data-testid="account-sessions-prototype-two">
        <section className="account-sessions-v2__security" aria-labelledby="account-sessions-v2-security-title">
          <span className="account-sessions-v2__security-icon"><ShieldCheck /></span>
          <div>
            <strong id="account-sessions-v2-security-title">Mantenha sua conta protegida</strong>
            <small>Revise as sessões ativas e encerre qualquer acesso que você não reconhecer.</small>
          </div>
        </section>

        <header className="account-sessions-v2__heading">
          <div>
            <h2>Sessões em dispositivos</h2>
            <span>{orderedSessions.length} {orderedSessions.length === 1 ? 'sessão encontrada' : 'sessões encontradas'}</span>
          </div>
          <div className="account-sessions-v2__heading-actions">
            <button type="button" disabled={loading} onClick={onRefresh}>
              <RefreshCw className={loading ? 'is-spinning' : ''} />
              <span>{loading ? 'Atualizando…' : 'Atualizar'}</span>
            </button>
            <button
              className="is-danger"
              type="button"
              disabled={revokingAll || otherSessions.length === 0}
              onClick={onRevokeOthers}
            >
              <LogOut />
              <span>{revokingAll ? 'Encerrando…' : 'Encerrar outras sessões'}</span>
            </button>
          </div>
        </header>

        {loading && orderedSessions.length === 0 ? (
          <div className="account-sessions-v2__state" role="status">Carregando sessões…</div>
        ) : orderedSessions.length === 0 ? (
          <div className="account-sessions-v2__state">Nenhuma sessão ativa foi encontrada.</div>
        ) : (
          <div className="account-sessions-v2__workspace">
            <aside className="account-sessions-v2__sidebar" aria-label="Lista de sessões">
              <div className="account-sessions-v2__filters" role="group" aria-label="Filtrar sessões">
                <button
                  className={filter === 'all' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setFilter('all')}
                >
                  Todas ({orderedSessions.length})
                </button>
                <button
                  className={filter === 'others' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setFilter('others')}
                >
                  Outras ({otherSessions.length})
                </button>
                <button
                  className={filter === 'current' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setFilter('current')}
                >
                  Este dispositivo ({orderedSessions.some(session => session.current) ? 1 : 0})
                </button>
              </div>

              <div className="account-sessions-v2__session-list">
                {visibleSessions.map(session => {
                  const sessionPosition = otherSessionPosition.get(session.id);
                  const title = session.current ? 'Este dispositivo' : `Outra sessão ${sessionPosition ?? ''}`.trim();
                  const selected = selectedSession?.id === session.id;
                  return (
                    <button
                      className={`account-sessions-v2__session-row${selected ? ' is-selected' : ''}`}
                      type="button"
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                    >
                      <span className="account-sessions-v2__session-icon"><Monitor /></span>
                      <span className="account-sessions-v2__session-copy">
                        <span>
                          <strong>{title}</strong>
                          {session.current && <em>Atual</em>}
                        </span>
                        <small>{session.current ? 'Navegador atual' : `Última atividade ${formatSessionDate(session.lastSeenAt)}`}</small>
                      </span>
                      <span className="account-sessions-v2__session-time">
                        {session.current ? 'Agora' : formatSessionAge(session.lastSeenAt)}
                      </span>
                      <ChevronRight />
                    </button>
                  );
                })}
              </div>
            </aside>

            {selectedSession && (
              <section className="account-sessions-v2__detail" aria-labelledby="account-sessions-v2-detail-title">
                <div className="account-sessions-v2__detail-hero">
                  <span className="account-sessions-v2__detail-icon"><Monitor /></span>
                  <div className="account-sessions-v2__detail-copy">
                    <span>
                      <h3 id="account-sessions-v2-detail-title">{selectedTitle}</h3>
                      {selectedSession.current && <em>Atual</em>}
                    </span>
                    <strong>{selectedSession.current ? 'Navegador atual' : 'Dispositivo conectado'}</strong>
                    <small>ID da sessão · {selectedSession.id.slice(0, 8)}</small>
                  </div>
                  <div className="account-sessions-v2__laptop" aria-hidden="true">
                    <span><i /></span>
                  </div>
                </div>

                <div className="account-sessions-v2__detail-body">
                  <h4>Informações da sessão</h4>
                  <div className="account-sessions-v2__metrics">
                    <div>
                      <Clock3 />
                      <span><small>Última atividade</small><strong>{formatSessionDate(selectedSession.lastSeenAt)}</strong><em>{formatSessionAge(selectedSession.lastSeenAt)}</em></span>
                    </div>
                    <div>
                      <TimerReset />
                      <span><small>Sessão iniciada</small><strong>{formatSessionDate(selectedSession.createdAt)}</strong><em>{formatSessionAge(selectedSession.createdAt)}</em></span>
                    </div>
                    <div>
                      <ShieldCheck />
                      <span><small>Expira em</small><strong>{formatSessionExpiration(selectedSession.expiresAt)}</strong><em>{formatSessionExpiration(selectedSession.expiresAt) === 'Não expira' ? 'Sessão permanente' : 'Expiração programada'}</em></span>
                    </div>
                    <div className="is-status">
                      <i />
                      <span><small>Status</small><strong>Ativa</strong><em>{selectedSession.current ? 'Em uso neste dispositivo' : 'Sessão conectada'}</em></span>
                    </div>
                  </div>

                  {selectedSession.current ? (
                    <>
                      <div className="account-sessions-v2__current-note">
                        <Info />
                        <span>
                          <strong>Esta é a sua sessão atual</strong>
                          <small>Você está usando o Home Music neste dispositivo. Para sair desta sessão, use a opção de logout no menu da sua conta.</small>
                        </span>
                      </div>
                      <div className="account-sessions-v2__device-details">
                        <h4>Detalhes do dispositivo</h4>
                        <div>
                          <span><Monitor /><small>Tipo de dispositivo</small><strong>Computador</strong></span>
                          <span><ShieldCheck /><small>Estado da sessão</small><strong>Protegida</strong></span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="account-sessions-v2__other-actions">
                      <div>
                        <ShieldCheck />
                        <span>
                          <strong>Gerencie este acesso</strong>
                          <small>Encerre a sessão caso você não reconheça este dispositivo.</small>
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(busySessionId)}
                        onClick={() => onRevokeOne(selectedSession)}
                      >
                        <LogOut />
                        <span>{busySessionId === selectedSession.id ? 'Encerrando…' : 'Encerrar esta sessão'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="account-sessions-screen">
      <section className="account-sessions-security" aria-labelledby="account-sessions-security-title">
        <span className="account-sessions-security__icon"><ShieldCheck /></span>
        <div>
          <strong id="account-sessions-security-title">Mantenha sua conta protegida</strong>
          <small>Revise as sessões ativas e encerre qualquer acesso que você não reconhecer.</small>
        </div>
      </section>

      <section className="account-sessions-list" aria-labelledby="account-sessions-list-title">
        <div className="account-sessions-list__heading">
          <strong id="account-sessions-list-title">Sessões conectadas</strong>
          {!loading && <span>{orderedSessions.length} {orderedSessions.length === 1 ? 'sessão' : 'sessões'}</span>}
        </div>

        {loading ? (
          <div className="account-sessions-loading" role="status">Carregando sessões…</div>
        ) : orderedSessions.length === 0 ? (
          <div className="account-sessions-empty">Nenhuma sessão ativa foi encontrada.</div>
        ) : (
          <div className="account-sessions-cards">
            {orderedSessions.map(session => {
              const sessionPosition = otherSessionPosition.get(session.id);
              const title = session.current ? 'Este dispositivo' : `Outra sessão ${sessionPosition ?? ''}`.trim();
              const ending = busySessionId === session.id;

              return (
                <details
                  className={`account-session-card${session.current ? ' is-current' : ''}`}
                  key={session.id}
                  open={!session.current}
                >
                  <summary>
                    <span className="account-session-card__device"><Monitor /></span>
                    <span className="account-session-card__summary-copy">
                      <span className="account-session-card__title-row">
                        <strong>{title}</strong>
                        {session.current && <span className="account-session-card__current">Atual</span>}
                      </span>
                      <small>
                        {session.current
                          ? 'Sessão usada neste navegador'
                          : `Última atividade ${formatSessionDate(session.lastSeenAt)}`}
                      </small>
                    </span>
                    <ChevronDown className="account-session-card__chevron" aria-hidden="true" />
                  </summary>

                  <div className="account-session-card__details">
                    <div className="account-session-card__detail">
                      <Clock3 />
                      <span><small>Última atividade</small><strong>{formatSessionDate(session.lastSeenAt)}</strong></span>
                    </div>
                    <div className="account-session-card__detail">
                      <TimerReset />
                      <span><small>Sessão iniciada</small><strong>{formatSessionDate(session.createdAt)}</strong></span>
                    </div>
                    <div className="account-session-card__detail">
                      <ShieldCheck />
                      <span><small>Expira em</small><strong>{formatSessionExpiration(session.expiresAt)}</strong></span>
                    </div>

                    {session.current ? (
                      <p className="account-session-card__current-note">Esta é a sessão que você está usando agora.</p>
                    ) : (
                      <button
                        className="account-session-card__revoke"
                        type="button"
                        disabled={Boolean(busySessionId)}
                        onClick={() => onRevokeOne(session)}
                      >
                        <LogOut /> {ending ? 'Encerrando…' : 'Encerrar esta sessão'}
                      </button>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <div className="account-sessions-footer">
        <button
          className="account-sessions-revoke-all"
          type="button"
          disabled={revokingAll || otherSessions.length === 0}
          onClick={onRevokeOthers}
        >
          <LogOut /> {revokingAll ? 'Encerrando…' : 'Encerrar todas as outras sessões'}
        </button>
        <small><ShieldCheck /> Isso não afetará este dispositivo.</small>
      </div>
    </div>
  );
}
