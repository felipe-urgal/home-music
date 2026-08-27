import { ShieldCheck, UserRound } from 'lucide-react';

type DesktopPlayerSidebarToolsProps = {
  username: string;
  accountActive?: boolean;
  administrationAvailable?: boolean;
  administrationActive?: boolean;
  onOpenAdministration?: () => void;
  onOpenAccount: () => void;
};

export function DesktopPlayerSidebarTools({
  username,
  accountActive = false,
  administrationAvailable = false,
  administrationActive = false,
  onOpenAdministration,
  onOpenAccount
}: DesktopPlayerSidebarToolsProps) {
  return (
    <div className="desktop-player-sidebar-tools">
      {administrationAvailable && onOpenAdministration && (
        <button
          className={`desktop-player-sidebar-tools__account ${administrationActive ? 'is-active' : ''}`}
          type="button"
          aria-current={administrationActive ? 'page' : undefined}
          onClick={onOpenAdministration}
        >
          <ShieldCheck />
          <span><strong>Administração</strong><small>Controles do sistema</small></span>
        </button>
      )}

      <button
        className={`desktop-player-sidebar-tools__account ${accountActive ? 'is-active' : ''}`}
        type="button"
        aria-current={accountActive ? 'page' : undefined}
        onClick={onOpenAccount}
      >
        <UserRound />
        <span><strong>Minha conta</strong><small>{username}</small></span>
      </button>
    </div>
  );
}
