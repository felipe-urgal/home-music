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
  const accountInitial = username.trim().charAt(0).toUpperCase() || 'U';

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
        <span className="desktop-player-sidebar-tools__initial" aria-hidden="true">{accountInitial}</span>
        <span className="desktop-player-sidebar-tools__copy"><strong>Minha conta</strong><small>{username}</small></span>
      </button>
    </div>
  );
}
