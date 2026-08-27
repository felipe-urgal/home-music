import { CirclePlay, LibraryBig, UserRound } from 'lucide-react';

type MobileBottomNavProps = {
  active: 'player' | 'library' | 'account';
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenAccount: () => void;
};

export function MobileBottomNav({
  active,
  onOpenPlayer,
  onOpenLibrary,
  onOpenAccount
}: MobileBottomNavProps) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Navegação principal">
      <button
        type="button"
        className={active === 'player' ? 'is-active' : ''}
        aria-current={active === 'player' ? 'page' : undefined}
        onClick={onOpenPlayer}
      >
        <CirclePlay aria-hidden="true" />
        <span>Agora</span>
      </button>
      <button
        type="button"
        className={active === 'library' ? 'is-active' : ''}
        aria-current={active === 'library' ? 'page' : undefined}
        onClick={onOpenLibrary}
      >
        <LibraryBig aria-hidden="true" />
        <span>Biblioteca</span>
      </button>
      <button
        type="button"
        className={active === 'account' ? 'is-active' : ''}
        aria-current={active === 'account' ? 'page' : undefined}
        onClick={onOpenAccount}
      >
        <UserRound aria-hidden="true" />
        <span>Conta</span>
      </button>
    </nav>
  );
}
