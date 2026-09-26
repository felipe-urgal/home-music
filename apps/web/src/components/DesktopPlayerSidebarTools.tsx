import { Disc3 } from 'lucide-react';

type DesktopPlayerSidebarToolsProps = {
  username: string;
  accountActive?: boolean;
  onOpenDjMode: () => void;
  onOpenAccount: () => void;
};

export function DesktopPlayerSidebarTools({
  username,
  accountActive = false,
  onOpenDjMode,
  onOpenAccount
}: DesktopPlayerSidebarToolsProps) {
  const accountLabel = `Minha conta · ${username}`;
  const accountInitial = username.trim().charAt(0).toUpperCase() || 'U';

  return (
    <div className="desktop-player-sidebar-tools">
      <button
        className="desktop-player-sidebar-tools__account"
        type="button"
        aria-label="Abrir Modo DJ"
        title="Modo DJ"
        onClick={onOpenDjMode}
      >
        <span className="desktop-player-sidebar-tools__initial" aria-hidden="true"><Disc3 /></span>
        <span className="desktop-player-sidebar-tools__copy"><strong>Modo DJ</strong><small>Dual-deck</small></span>
      </button>

      <button
        className={`desktop-player-sidebar-tools__account ${accountActive ? 'is-active' : ''}`}
        type="button"
        aria-current={accountActive ? 'page' : undefined}
        aria-label={accountLabel}
        title={accountLabel}
        onClick={onOpenAccount}
      >
        <span className="desktop-player-sidebar-tools__initial" aria-hidden="true">{accountInitial}</span>
        <span className="desktop-player-sidebar-tools__copy"><strong>Minha conta</strong><small>{username}</small></span>
      </button>
    </div>
  );
}
