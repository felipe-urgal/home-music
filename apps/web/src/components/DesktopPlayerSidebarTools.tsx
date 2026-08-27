import { UserRound } from 'lucide-react';

type DesktopPlayerSidebarToolsProps = {
  username: string;
  accountActive?: boolean;
  onOpenAccount: () => void;
};

export function DesktopPlayerSidebarTools({
  username,
  accountActive = false,
  onOpenAccount
}: DesktopPlayerSidebarToolsProps) {
  return (
    <div className="desktop-player-sidebar-tools">
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
