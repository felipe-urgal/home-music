import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OpenSubsonicAccountKey, OpenSubsonicKeyCreateResponse, OpenSubsonicKeysResponse } from '@home-music/shared/open-subsonic';
import { apiFetch } from '../api-client';
import { ActionDialog } from './ActionDialog';

async function readError(response: Response): Promise<string> {
  const result = await response.json().catch(() => null) as { error?: string } | null;
  return result?.error || `Falha HTTP ${response.status}.`;
}

export function AccountOpenSubsonicKeys() {
  const [keys, setKeys] = useState<OpenSubsonicAccountKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<OpenSubsonicKeyCreateResponse | null>(null);
  const [revoke, setRevoke] = useState<OpenSubsonicAccountKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch('/api/auth/open-subsonic/keys', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(await readError(response));
        const data = await response.json() as OpenSubsonicKeysResponse;
        if (!Array.isArray(data.keys)) throw new Error('Resposta inválida ao carregar chaves.');
        if (!controller.signal.aborted) setKeys(data.keys);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as chaves.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !name.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/open-subsonic/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Home-Music-Request': '1' },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as OpenSubsonicKeyCreateResponse;
      if (!data.key?.id || !data.token) throw new Error('Resposta inválida ao criar chave.');
      setKeys(previous => [data.key, ...previous]);
      setCreated(data);
      setName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar a chave.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function revokeKey() {
    if (!revoke || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/auth/open-subsonic/keys/${encodeURIComponent(revoke.id)}`, {
        method: 'DELETE',
        headers: { 'X-Home-Music-Request': '1' }
      });
      if (!response.ok) throw new Error(await readError(response));
      setKeys(previous => previous.filter(key => key.id !== revoke.id));
      setRevoke(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível revogar a chave.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="account-open-subsonic">
      <p>Crie uma chave por aplicativo para usar clientes OpenSubsonic sem compartilhar sua senha.</p>
      {error && <p role="alert" className="my-account-message is-error">{error}</p>}
      <form onSubmit={event => void createKey(event)}>
        <label htmlFor="open-subsonic-name">Nome do aplicativo</label>
        <input id="open-subsonic-name" value={name} onChange={event => setName(event.target.value)}
          maxLength={120} required disabled={busy} autoComplete="off" placeholder="Ex.: Feishin no notebook" />
        <button type="submit" disabled={busy || !name.trim()}>Criar chave</button>
      </form>
      {created && (
        <section aria-label="Nova chave OpenSubsonic" className="my-account-message">
          <strong>Copie agora: esta chave será exibida somente uma vez.</strong>
          <p><code style={{ overflowWrap: 'anywhere' }}>{created.token}</code></p>
          <button type="button" onClick={() => void navigator.clipboard.writeText(created.token).catch(() => setError('Não foi possível copiar automaticamente. Selecione o texto para copiar.'))}>Copiar chave</button>
          <button type="button" onClick={() => setCreated(null)}>Já guardei minha chave</button>
        </section>
      )}
      <h2>Chaves cadastradas</h2>
      {loading ? <p role="status">Carregando chaves…</p> : keys.length === 0 ? <p>Nenhuma chave cadastrada.</p> : (
        <ul>
          {keys.map(key => <li key={key.id}>
            <strong>{key.name}</strong> · {key.hint} · {new Date(key.createdAt).toLocaleDateString('pt-BR')}
            <button type="button" disabled={busy} onClick={() => setRevoke(key)}>Revogar</button>
          </li>)}
        </ul>
      )}
      <ActionDialog open={revoke !== null} title="Revogar chave OpenSubsonic"
        description={revoke ? `Revogar a chave "${revoke.name}"? O aplicativo que a utiliza perderá o acesso.` : ''}
        confirmLabel="Revogar chave" danger busy={busy} error={error}
        onClose={() => { setRevoke(null); setError(null); }} onConfirm={() => void revokeKey()} />
    </div>
  );
}
