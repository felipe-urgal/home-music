import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw, Smartphone, X } from 'lucide-react';
import type { TvRemoteTransportStatus } from '../tv-remote-client';
import { tvRemoteQrDataUrl } from '../tv-remote-qr';

type TvRemotePairingDialogProps = {
  open: boolean;
  state: 'idle' | 'creating' | 'waiting' | 'connected' | 'error' | 'closed';
  transport: TvRemoteTransportStatus;
  pairingUrl: string | null;
  error: string | null;
  onClose: () => void;
  onRegenerate: () => void;
};

const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function TvRemotePairingDialog({
  open, state, transport, pairingUrl, error, onClose, onRegenerate
}: TvRemotePairingDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  const qrDataUrl = useMemo(() => {
    if (!pairingUrl) return null;
    try {
      return tvRemoteQrDataUrl(pairingUrl);
    } catch {
      return null;
    }
  }, [pairingUrl]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter(element => element.getClientRects().length > 0);
      if (focusables.length < 2) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = Math.max(0, focusables.indexOf(active ?? focusables[0]));
      const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + focusables.length) % focusables.length;
      event.preventDefault();
      focusables[nextIndex]?.focus({ preventScroll: true });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) {
        window.requestAnimationFrame(() => returnTarget.focus({ preventScroll: true }));
      }
    };
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
      <section ref={dialogRef} className="tv-remote-dialog" role="dialog" aria-modal="true" aria-labelledby="tv-remote-title">
        <header>
          <div><Smartphone aria-hidden="true" /><div><small>Controle pelo celular</small><h2 id="tv-remote-title">Conectar celular</h2></div></div>
          <button ref={closeRef} type="button" aria-label="Fechar controle remoto" onClick={onClose}><X /></button>
        </header>
        <p className={`tv-remote-dialog__status tv-remote-dialog__status--${state}`} aria-live="polite">{status}</p>
        {pairingUrl ? (
          <>
            {qrDataUrl && (
              <div className="tv-remote-dialog__qr">
                <img src={qrDataUrl} alt="QR code para abrir o controle remoto no celular" width="280" height="280" />
                <strong>Aponte a câmera do celular</strong>
              </div>
            )}
            <p>{qrDataUrl ? 'Ou abra este endereço no celular conectado ao mesmo Home Music:' : 'Abra este endereço no celular conectado ao mesmo Home Music:'}</p>
            <a className="tv-remote-dialog__url" href={pairingUrl}>{pairingUrl}</a>
            <div className="tv-remote-dialog__actions">
              <button type="button" onClick={() => void copyUrl()}><Copy />{copied ? 'Copiado' : 'Copiar endereço'}</button>
              <button type="button" onClick={onRegenerate}><RefreshCw />Gerar novo código</button>
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
