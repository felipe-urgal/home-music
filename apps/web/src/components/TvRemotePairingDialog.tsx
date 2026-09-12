import { useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw, Smartphone, X } from 'lucide-react';
import type { TvRemoteTransportStatus } from '../tv-remote-client';

type TvRemotePairingDialogProps = {
  open: boolean;
  state: 'idle' | 'creating' | 'waiting' | 'connected' | 'error' | 'closed';
  transport: TvRemoteTransportStatus;
  pairingUrl: string | null;
  error: string | null;
  onClose: () => void;
  onRegenerate: () => void;
};

export function TvRemotePairingDialog({
  open, state, transport, pairingUrl, error, onClose, onRegenerate
}: TvRemotePairingDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => setCopied(false), [pairingUrl]);
  if (!open) return null;

  const status = state === 'creating' ? 'Gerando código…'
    : state === 'connected' ? 'Celular conectado'
      : state === 'waiting' && transport === 'error' ? 'Reconectando a sessão…'
        : state === 'waiting' ? 'Aguardando o celular'
          : state === 'closed' ? 'Sessão encerrada'
            : state === 'error' ? 'Não foi possível iniciar'
              : 'Controle remoto';

  async function copyUrl() {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="tv-remote-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="tv-remote-dialog" role="dialog" aria-modal="true" aria-labelledby="tv-remote-title">
        <header>
          <div><Smartphone aria-hidden="true" /><div><small>Controle pelo celular</small><h2 id="tv-remote-title">Conectar celular</h2></div></div>
          <button ref={closeRef} type="button" aria-label="Fechar controle remoto" onClick={onClose}><X /></button>
        </header>
        <p className={`tv-remote-dialog__status tv-remote-dialog__status--${state}`} aria-live="polite">{status}</p>
        {pairingUrl ? (
          <>
            <p>Abra este endereço no celular conectado ao mesmo Home Music:</p>
            <a className="tv-remote-dialog__url" href={pairingUrl}>{pairingUrl}</a>
            <div className="tv-remote-dialog__actions">
              <button type="button" onClick={() => void copyUrl()}><Copy />{copied ? 'Copiado' : 'Copiar endereço'}</button>
              <button type="button" onClick={onRegenerate}><RefreshCw />Novo código</button>
            </div>
          </>
        ) : state === 'creating' ? (
          <div className="tv-remote-dialog__loading" aria-hidden="true" />
        ) : null}
        {error && <p className="tv-remote-dialog__error" role="alert">{error}</p>}
        <small className="tv-remote-dialog__privacy">A sessão expira automaticamente e só funciona com a mesma conta autenticada.</small>
      </section>
    </div>
  );
}
