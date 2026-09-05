import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, LoaderCircle, Trash2 } from 'lucide-react';
import {
  createOpenSubsonicKey,
  listOpenSubsonicKeys,
  revokeOpenSubsonicKey,
  type AccountOpenSubsonicKey
} from '../account-client';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function createdLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

export function AccountOpenSubsonicKeys() {
  const [keys, setKeys] = useState<AccountOpenSubsonicKey[]>([]);
  const [name, setName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listOpenSubsonicKeys()
      .then(items => { if (active) setKeys(items); })
      .catch(error => { if (active) setError(errorMessage(error)); })
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
      setKeys(items => [created.key, ...items]);
      setCreatedToken(created.token);
      setName('');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function copyToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
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
      setKeys(items => items.filter(item => item.id !== key.id));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRevokingId(null);
    }
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
              <input readOnly value={createdToken} aria-label="API key OpenSubsonic recém-criada" onFocus={event => event.currentTarget.select()} />
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
