import { ChevronDown, Clock3, LogOut, Monitor, ShieldCheck, TimerReset } from 'lucide-react';
import type { AccountSession } from '../account-client';

type AccountSessionsScreenProps = {
  sessions: AccountSession[];
  loading: boolean;
  busySessionId: string | null;
  revokingAll: boolean;
  onRevokeOne: (session: AccountSession) => void;
  onRevokeOthers: () => void;
};

function formatSessionDate(value: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function AccountSessionsScreen({
  sessions,
  loading,
  busySessionId,
  revokingAll,
  onRevokeOne,
  onRevokeOthers
}: AccountSessionsScreenProps) {
  const orderedSessions = [...sessions].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return right.lastSeenAt - left.lastSeenAt;
  });
  const otherSessions = orderedSessions.filter(session => !session.current);
  const otherSessionPosition = new Map(otherSessions.map((session, index) => [session.id, index + 1]));

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
                      <span><small>Expira em</small><strong>{formatSessionDate(session.expiresAt)}</strong></span>
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
