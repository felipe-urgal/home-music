import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, Copy, KeyRound, LoaderCircle, Plus, Trash2, UserRound, UsersRound } from 'lucide-react';
import {
  createOpenSubsonicKey,
  listOpenSubsonicKeys,
  revokeOpenSubsonicKey,
  type AccountOpenSubsonicKey
} from '../account-client';
import { reconcileOpenSubsonicKeySnapshot } from '../open-subsonic-key-state';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function createdLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

type CreatedToken = {
  keyId: string;
  token: string;
};

type AccountOpenSubsonicKeysProps = {
  prototypeTwo?: boolean;
  onBack?: () => void;
};

export function AccountOpenSubsonicKeys({
  prototypeTwo = false,
  onBack
}: AccountOpenSubsonicKeysProps = {}) {
  const [keys, setKeys] = useState<AccountOpenSubsonicKey[]>([]);
  const [name, setName] = useState('');
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutationGenerationRef = useRef(0);
  const revokedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    const generationAtStart = mutationGenerationRef.current;
    setLoading(true);
    setError(null);
    void listOpenSubsonicKeys()
      .then(items => {
        if (!active) return;
        if (generationAtStart === mutationGenerationRef.current) {
          setKeys(items);
          return;
        }
        setKeys(current => reconcileOpenSubsonicKeySnapshot(current, items, revokedIdsRef.current));
      })
      .catch(caught => {
        if (active && generationAtStart === mutationGenerationRef.current) {
          setError(errorMessage(caught));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || creating) return;
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const created = await createOpenSubsonicKey(cleanName);
      mutationGenerationRef.current += 1;
      revokedIdsRef.current.delete(created.key.id);
      setKeys(items => [created.key, ...items.filter(item => item.id !== created.key.id)]);
      setCreatedToken({ keyId: created.key.id, token: created.token });
      setName('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function copyToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione a chave e copie manualmente.');
    }
  }

  async function revoke(key: AccountOpenSubsonicKey) {
    if (revokingId) return;
    if (!window.confirm(`Revogar a chave “${key.name}”? O aplicativo perderá acesso imediatamente.`)) return;
    setRevokingId(key.id);
    setError(null);
    try {
      await revokeOpenSubsonicKey(key.id);
      mutationGenerationRef.current += 1;
      revokedIdsRef.current.add(key.id);
      setKeys(items => items.filter(item => item.id !== key.id));
      if (createdToken?.keyId === key.id) {
        setCreatedToken(null);
        setCopied(false);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRevokingId(null);
    }
  }

  if (prototypeTwo) {
    return (
      <div className="account-apps-v2" data-testid="account-apps-prototype-two">
        <header className="account-apps-v2__page-header">
          <button type="button" onClick={onBack}>
            <ChevronLeft />
            <span>Minha conta</span>
          </button>
          <div className="account-apps-v2__intro">
            <h1 id="account-apps-v2-title">Apps e integrações</h1>
            <p>Conecte seus apps e serviços favoritos ao Home Music.</p>
          </div>
          <span aria-hidden="true" />
        </header>

        {error && <div className="my-account-message is-error account-apps-v2__message" role="alert">{error}</div>}

        <section className="account-apps-v2__create" aria-labelledby="account-apps-v2-create-title">
          <header className="account-apps-v2__section-heading">
            <span className="account-apps-v2__section-icon is-violet"><KeyRound /></span>
            <div>
              <strong id="account-apps-v2-create-title">Nova chave de aplicativo</strong>
              <small>Crie uma credencial separada para cada cliente OpenSubsonic.</small>
            </div>
          </header>

          <form className="account-apps-v2__create-form" onSubmit={submit}>
            <input
              value={name}
              maxLength={120}
              autoComplete="off"
              disabled={creating}
              aria-label="Nome do aplicativo"
              placeholder="Ex.: Symfonium no celular"
              onChange={event => setName(event.target.value)}
            />
            <button type="submit" disabled={creating || !name.trim()}>
              {creating ? <LoaderCircle className="my-account-spinner" /> : <Plus />}
              <span>{creating ? 'Criando…' : 'Criar chave'}</span>
            </button>
          </form>
        </section>

        {createdToken && (
          <section className="account-apps-v2__token" aria-labelledby="account-apps-v2-token-title">
            <header className="account-apps-v2__section-heading">
              <span className="account-apps-v2__section-icon is-violet"><KeyRound /></span>
              <div>
                <strong id="account-apps-v2-token-title">Copie esta chave agora</strong>
                <small>Ela é exibida somente nesta criação e não pode ser recuperada depois.</small>
              </div>
            </header>
            <div className="account-apps-v2__token-row">
              <input
                readOnly
                value={createdToken.token}
                aria-label="API key OpenSubsonic recém-criada"
                onFocus={event => event.currentTarget.select()}
              />
              <button type="button" onClick={() => void copyToken()}>
                <Copy />
                <span>{copied ? 'Copiada' : 'Copiar chave'}</span>
              </button>
            </div>
            <small>Servidor: <strong>{window.location.origin}</strong>. Configure o cliente para usar autenticação por API key.</small>
          </section>
        )}

        <section className="account-apps-v2__authorized" aria-labelledby="account-apps-v2-authorized-title">
          <header className="account-apps-v2__section-heading">
            <span className="account-apps-v2__section-icon is-blue"><UsersRound /></span>
            <div>
              <strong id="account-apps-v2-authorized-title">Aplicativos autorizados</strong>
              <small>Revogue acessos que você não usa mais.</small>
            </div>
          </header>

          {loading ? (
            <div className="account-apps-v2__state" role="status">
              <LoaderCircle className="my-account-spinner" />
              <span>Carregando chaves…</span>
            </div>
          ) : keys.length === 0 ? (
            <div className="account-apps-v2__state">Nenhuma chave OpenSubsonic criada.</div>
          ) : (
            <div className="account-apps-v2__list">
              {keys.map(key => (
                <div className="account-apps-v2__row" key={key.id}>
                  <span className="account-apps-v2__row-icon"><UserRound /></span>
                  <div className="account-apps-v2__row-copy">
                    <strong>{key.name}</strong>
                    <small>{key.hint} · criada em {createdLabel(key.createdAt)}</small>
                  </div>
                  <span className="account-apps-v2__status"><i /> Ativo</span>
                  <button
                    className="account-apps-v2__revoke"
                    type="button"
                    disabled={Boolean(revokingId)}
                    onClick={() => void revoke(key)}
                    aria-label={`Revogar ${key.name}`}
                  >
                    {revokingId === key.id ? <LoaderCircle className="my-account-spinner" /> : <Trash2 />}
                    <span>{revokingId === key.id ? 'Revogando…' : 'Revogar'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="my-account-message is-error" role="alert">{error}</div>}

      <section className="my-account-card" aria-labelledby="open-subsonic-create-title">
        <div className="my-account-card__heading">
          <span className="my-account-card__icon"><KeyRound /></span>
          <div>
            <strong id="open-subsonic-create-title">Nova chave de aplicativo</strong>
            <small>Crie uma credencial separada para cada cliente OpenSubsonic.</small>
          </div>
        </div>

        <form className="my-account-password-form" onSubmit={submit}>
          <label className="my-account-password-form__current">
            <span>Nome do aplicativo</span>
            <input
              value={name}
              maxLength={120}
              autoComplete="off"
              disabled={creating}
              placeholder="Ex.: Symfonium no celular"
              onChange={event => setName(event.target.value)}
            />
          </label>
          <button className="primary-action my-account-action" type="submit" disabled={creating || !name.trim()}>
            {creating && <LoaderCircle className="my-account-spinner" />}
            {creating ? 'Criando…' : 'Criar chave'}
          </button>
        </form>
        <p className="my-account-card__note">A senha da sua conta não é compartilhada com o aplicativo. Cada chave pode ser revogada sem encerrar sua sessão web.</p>
      </section>

      {createdToken && (
        <section className="my-account-card" aria-labelledby="open-subsonic-token-title">
          <div className="my-account-card__heading">
            <span className="my-account-card__icon"><KeyRound /></span>
            <div>
              <strong id="open-subsonic-token-title">Copie esta chave agora</strong>
              <small>Ela é exibida somente nesta criação e não pode ser recuperada depois.</small>
            </div>
          </div>
          <div className="my-account-password-form">
            <label className="my-account-password-form__current">
              <span>API key</span>
              <input readOnly value={createdToken.token} aria-label="API key OpenSubsonic recém-criada" onFocus={event => event.currentTarget.select()} />
            </label>
            <button className="primary-action my-account-action" type="button" onClick={() => void copyToken()}>
              <Copy /> {copied ? 'Copiada' : 'Copiar chave'}
            </button>
          </div>
          <p className="my-account-card__note">Servidor: <strong>{window.location.origin}</strong>. Configure o cliente para usar autenticação por API key.</p>
        </section>
      )}

      <section className="my-account-card" aria-labelledby="open-subsonic-keys-title">
        <div className="my-account-card__heading">
          <span className="my-account-card__icon"><KeyRound /></span>
          <div>
            <strong id="open-subsonic-keys-title">Aplicativos autorizados</strong>
            <small>Revogue acessos que você não usa mais.</small>
          </div>
        </div>

        {loading ? (
          <div className="my-account-sessions-loading"><LoaderCircle className="my-account-spinner" /> Carregando chaves…</div>
        ) : keys.length === 0 ? (
          <p className="my-account-card__note">Nenhuma chave OpenSubsonic criada.</p>
        ) : (
          <div className="my-account-session-list">
            {keys.map(key => (
              <div className="my-account-session-row" key={key.id}>
                <span className="my-account-session-row__icon"><KeyRound /></span>
                <div>
                  <strong>{key.name}</strong>
                  <small>{key.hint} · criada em {createdLabel(key.createdAt)}</small>
                </div>
                <button type="button" disabled={Boolean(revokingId)} onClick={() => void revoke(key)} aria-label={`Revogar ${key.name}`}>
                  {revokingId === key.id ? <LoaderCircle className="my-account-spinner" /> : <Trash2 />}
                  {revokingId === key.id ? 'Revogando…' : 'Revogar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
