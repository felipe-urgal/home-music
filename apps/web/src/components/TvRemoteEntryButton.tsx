import { useEffect, useRef } from 'react';
import { ChevronRight, Smartphone } from 'lucide-react';
import '../tv-remote-inline.css';

type TvRemoteEntryButtonProps = {
  onClick: () => void;
  autoFocus?: boolean;
};

export function TvRemoteEntryButton({ onClick, autoFocus = false }: TvRemoteEntryButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => {
      buttonRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  return (
    <button
      ref={buttonRef}
      className="tv-remote-entry-button"
      data-tv-entry
      type="button"
      onClick={onClick}
      aria-label="Controlar pelo celular"
    >
      <Smartphone className="tv-remote-entry-button__phone" aria-hidden="true" />
      <span className="tv-remote-entry-button__copy">
        <strong>Controlar pelo celular</strong>
        <small>Escaneie o QR Code e escolha suas músicas</small>
      </span>
      <ChevronRight className="tv-remote-entry-button__chevron" aria-hidden="true" />
    </button>
  );
}
