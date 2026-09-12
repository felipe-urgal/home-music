import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone } from 'lucide-react';

type TvRemoteEntryButtonProps = {
  onClick: () => void;
};

export function TvRemoteEntryButton({ onClick }: TvRemoteEntryButtonProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.querySelector<HTMLElement>('.tv-topbar'));
  }, []);

  if (!target) return null;
  return createPortal(
    <button
      data-tv-zone="content"
      className="tv-remote-open-button"
      type="button"
      aria-label="Conectar controle pelo celular"
      title="Controle pelo celular"
      onClick={onClick}
    >
      <Smartphone aria-hidden="true" />
    </button>,
    target
  );
}
