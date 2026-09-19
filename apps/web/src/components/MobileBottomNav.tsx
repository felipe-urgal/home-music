import { Folder, ListMusic, Music2, Search, UserRound } from 'lucide-react';
import { navigateAppPath } from '../browser-navigation';
import type { LibraryTab } from '../useLibraryNavigation';

type MobileBottomNavProps = {
  active: 'player' | 'library' | 'account';
  libraryTab?: LibraryTab;
  username?: string;
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenFolders?: () => void;
  onOpenPlaylists?: () => void;
  onOpenAccount: () => void;
};

export function MobileBottomNav({
  active,
  libraryTab,
  username,
  onOpenPlayer,
  onOpenLibrary,
  onOpenFolders,
  onOpenPlaylists,
  onOpenAccount
}: MobileBottomNavProps) {
  const accountInitial = username?.trim().charAt(0).toUpperCase() || 'U';

  function openLibraryRoute(path: '/library' | '/library/playlists', action?: () => void) {
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

  const foldersActive = active === 'library' && libraryTab !== 'playlists';
  const playlistsActive = active === 'library' && libraryTab === 'playlists';

  return (
    <>
      {active === 'library' && (
        <header className="mobile-library-brand-bar">
          <button className="mobile-library-brand-bar__brand" type="button" onClick={() => openLibraryRoute('/library', onOpenFolders)}>
            <span><Music2 aria-hidden="true" /></span>
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
        <button className={active === 'player' ? 'is-active' : ''} type="button" aria-current={active === 'player' ? 'page' : undefined} onClick={onOpenPlayer}>
          <Music2 aria-hidden="true" />
          <span>Tocando agora</span>
        </button>
        <button className={foldersActive ? 'is-active' : ''} type="button" aria-current={foldersActive ? 'page' : undefined} onClick={() => openLibraryRoute('/library', onOpenFolders)}>
          <Folder aria-hidden="true" />
          <span>Pastas</span>
        </button>
        <button className={playlistsActive ? 'is-active' : ''} type="button" aria-current={playlistsActive ? 'page' : undefined} onClick={() => openLibraryRoute('/library/playlists', onOpenPlaylists)}>
          <ListMusic aria-hidden="true" />
          <span>Playlists</span>
        </button>
      </nav>
    </>
  );
}
