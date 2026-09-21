import { useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  Clock3,
  EllipsisVertical,
  LockKeyhole,
  LogOut,
  Monitor,
  ShieldCheck,
  TimerReset,
  Trash2
} from 'lucide-react';
import type { AccountSession } from '../account-client';

type AccountSessionsScreenProps = {
  sessions: AccountSession[];
  loading: boolean;
  busySessionId: string | null;
  revokingAll: boolean;
  prototypeTwo?: boolean;
  onBack?: () => void;
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

export function AccountSessionsScreen({
  sessions,
  loading,
  busySessionId,
  revokingAll,
  prototypeTwo = false,
  onBack,
  onRevokeOne,
  onRevokeOthers
}: AccountSessionsScreenProps) {
  const orderedSessions = [...sessions].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return right.lastSeenAt - left.lastSeenAt;
  });
  const otherSessions = orderedSessions.filter(session => !session.current);
  const otherSessionPosition = new Map(otherSessions.map((session, index) => [session.id, index + 1]));
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);

  if (prototypeTwo) {
    return (
      <div className="account-sessions-v2" data-testid="account-sessions-prototype-two">
        <header className="account-sessions-v2__topbar">
          <button type="button" onClick={onBack}>
            <ChevronLeft />
            <span>Minha conta</span>
          </button>
          <span className="account-sessions-v2__help" aria-label="Ajuda">
            <CircleHelp />
            <span>Ajuda</span>
          </span>
        </header>

        <section className="account-sessions-v2__intro" aria-labelledby="account-sessions-v2-title">
          <h1 id="account-sessions-v2-title">Outros dispositivos</h1>
          <p>Gerencie as sessões ativas da sua conta.</p>
        </section>

        <section className="account-sessions-v2__security" aria-labelledby="account-sessions-v2-security-title">
          <span className="account-sessions-v2__security-icon"><ShieldCheck /></span>
          <div>
            <strong id="account-sessions-v2-security-title">Mantenha sua conta segura</strong>
            <small>Se não reconhecer um dispositivo, encerre a sessão.</small>
          </div>
        </section>

        <section className="account-sessions-v2__sessions" aria-labelledby="account-sessions-v2-sessions-title">
          <h2 id="account-sessions-v2-sessions-title">Sessões ativas</h2>

          {loading ? (
            <div className="account-sessions-v2__state" role="status">Carregando sessões…</div>
          ) : orderedSessions.length === 0 ? (
            <div className="account-sessions-v2__state">Nenhuma sessão ativa foi encontrada.</div>
          ) : (
            <div className="account-sessions-v2__cards">
              {orderedSessions.map(session => {
                const sessionPosition = otherSessionPosition.get(session.id);
                const title = session.current ? 'Este dispositivo' : `Outra sessão ${sessionPosition ?? ''}`.trim();
                const ending = busySessionId === session.id;
                const menuOpen = openMenuSessionId === session.id;

                return (
                  <article
                    className={`account-sessions-v2__card${session.current ? ' is-current' : ''}`}
                    key={session.id}
                  >
                    <span className="account-sessions-v2__device"><Monitor /></span>

                    <div className="account-sessions-v2__card-copy">
                      <span className="account-sessions-v2__title-row">
                        <strong>{title}</strong>
                        {session.current && <em>Atual</em>}
                      </span>

                      <span>{session.current ? 'Sessão usada neste navegador' : 'Dispositivo conectado'}</span>

                      {session.current ? (
                        <small className="is-active">Ativo agora</small>
                      ) : (
                        <>
                          <small>Última atividade · {formatSessionDate(session.lastSeenAt)}</small>
                          <small>ID {session.id.slice(0, 8)}</small>
                        </>
                      )}
                    </div>

                    {session.current ? (
                      <span className="account-sessions-v2__verified" aria-label="Sessão atual protegida">
                        <ShieldCheck />
                      </span>
                    ) : (
                      <div className="account-sessions-v2__menu">
                        <button
                          type="button"
                          aria-label={`Opções de ${title}`}
                          aria-expanded={menuOpen}
                          onClick={() => setOpenMenuSessionId(menuOpen ? null : session.id)}
                        >
                          <EllipsisVertical />
                        </button>
                        {menuOpen && (
                          <div className="account-sessions-v2__menu-popover" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              disabled={Boolean(busySessionId)}
                              onClick={() => {
                                setOpenMenuSessionId(null);
                                onRevokeOne(session);
                              }}
                            >
                              <LogOut />
                              <span>{ending ? 'Encerrando…' : 'Encerrar sessão'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <footer className="account-sessions-v2__footer">
          <button
            className="account-sessions-v2__revoke-all"
            type="button"
            disabled={revokingAll || otherSessions.length === 0}
            onClick={onRevokeOthers}
          >
            <Trash2 />
            <span>{revokingAll ? 'Encerrando…' : 'Encerrar todas as outras sessões'}</span>
          </button>
          <small><LockKeyhole /> Isso não afetará este dispositivo.</small>
        </footer>
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
