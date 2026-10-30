import { AudioLines, Library, Music2, Search, UserRound } from 'lucide-react';
import { navigateAppPath } from '../browser-navigation';

type MobileBottomNavProps = {
  active: 'player' | 'library' | 'account';
  username?: string;
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenFolders?: () => void;
  onOpenAccount: () => void;
};

export function MobileBottomNav({
  active,
  username,
  onOpenPlayer,
  onOpenLibrary,
  onOpenFolders,
  onOpenAccount
}: MobileBottomNavProps) {
  const accountInitial = username?.trim().charAt(0).toUpperCase() || 'U';

  function openLibraryRoute(path: '/library', action?: () => void) {
    if (action) {
      action();
      return;
    }
    onOpenLibrary();
    navigateAppPath(path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function focusLibrarySearch() {
    openLibraryRoute('/library', onOpenFolders);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('.search-box--library input')?.focus();
    });
  }

  if (active === 'player') return null;

  const libraryActive = active === 'library';

  return (
    <>
      {active === 'library' && (
        <header className="mobile-library-brand-bar">
          <button className="mobile-library-brand-bar__brand" type="button" onClick={() => openLibraryRoute('/library', onOpenFolders)}>
            <span><AudioLines aria-hidden="true" /></span>
            <strong>Home Music</strong>
          </button>
          <div className="mobile-library-brand-bar__actions">
            <button type="button" aria-label="Buscar na biblioteca" onClick={focusLibrarySearch}><Search aria-hidden="true" /></button>
            <button className="mobile-library-brand-bar__account" type="button" aria-label={username ? `Minha conta · ${username}` : 'Minha conta'} onClick={onOpenAccount}>
              <UserRound aria-hidden="true" />
              <span aria-hidden="true">{accountInitial}</span>
            </button>
          </div>
        </header>
      )}

      <nav className="mobile-bottom-nav" aria-label="Navegação principal">
        <button type="button" onClick={onOpenPlayer}>
          <Music2 aria-hidden="true" />
          <span>Tocando Agora</span>
        </button>
        <button className={libraryActive ? 'is-active' : ''} type="button" aria-current={libraryActive ? 'page' : undefined} onClick={() => openLibraryRoute('/library', onOpenFolders)}>
          <Library aria-hidden="true" />
          <span>Biblioteca</span>
        </button>
      </nav>
    </>
  );
}
