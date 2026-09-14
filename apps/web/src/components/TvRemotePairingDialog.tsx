import { useEffect, useMemo, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { TvRemoteTransportStatus } from '../tv-remote-client';
import { tvRemoteQrDataUrl } from '../tv-remote-qr';
import '../tv-remote-inline.css';

type TvRemotePairingDialogProps = {
  open: boolean;
  state: 'idle' | 'creating' | 'waiting' | 'connected' | 'error' | 'closed';
  transport: TvRemoteTransportStatus;
  pairingUrl: string | null;
  error: string | null;
  onClose: () => void;
  onRegenerate: () => void;
};

export function TvRemotePairingDialog({ open, state, pairingUrl, error, onClose, onRegenerate }: TvRemotePairingDialogProps) {
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'BrowserBack') return;
      event.preventDefault();
      onClose();
      document.querySelector<HTMLButtonElement>('[data-tv-entry]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const qrDataUrl = useMemo(() => {
    if (!pairingUrl) return null;
    try {
      return tvRemoteQrDataUrl(pairingUrl);
    } catch {
      return null;
    }
  }, [pairingUrl]);

  if (!open) return null;

  if (pairingUrl && qrDataUrl) {
    return (
      <aside ref={rootRef} className="tv-now-playing__qr tv-remote-inline-qr" aria-label="Controle pelo celular">
        <a href={pairingUrl} aria-label="Abrir controle no celular">
          <img src={qrDataUrl} alt="QR code para controlar a TV pelo celular" width="124" height="124" />
        </a>
      </aside>
    );
  }

  return (
    <aside ref={rootRef} className="tv-now-playing__qr tv-remote-inline-qr tv-remote-inline-qr--status" aria-live="polite">
      {state === 'error' || error ? (
        <button type="button" onClick={onRegenerate}><RefreshCw aria-hidden="true" /> Tentar novamente</button>
      ) : (
        <span>Preparando celular...</span>
      )}
    </aside>
  );
}
