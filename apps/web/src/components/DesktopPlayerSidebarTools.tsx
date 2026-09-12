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
  const accountLabel = `Minha conta · ${username}`;

  return (
    <div className="desktop-player-sidebar-tools">
      <button
        className={`desktop-player-sidebar-tools__account ${accountActive ? 'is-active' : ''}`}
        type="button"
        aria-current={accountActive ? 'page' : undefined}
        aria-label={accountLabel}
        title={accountLabel}
        onClick={onOpenAccount}
      >
        <UserRound aria-hidden="true" />
        <span><strong>Minha conta</strong><small>{username}</small></span>
      </button>
    </div>
  );
}
