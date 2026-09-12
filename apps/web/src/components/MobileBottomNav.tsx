import { useEffect, useState } from 'react';
import { Folder, ListMusic, Menu, Music2, Radio, UserRound, X } from 'lucide-react';
import { navigateAppPath } from '../browser-navigation';

type MobileBottomNavProps = {
  active: 'player' | 'library' | 'account';
  username?: string;
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenFolders?: () => void;
  onOpenPlaylists?: () => void;
  onOpenAccount: () => void;
};

export function MobileBottomNav({
  active,
  username,
  onOpenPlayer,
  onOpenLibrary,
  onOpenFolders,
  onOpenPlaylists,
  onOpenAccount
}: MobileBottomNavProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function navigate(action: () => void) {
    action();
    setOpen(false);
  }

  function navigateLibraryRoute(path: '/library' | '/library/playlists', action?: () => void) {
    if (action) {
      navigate(action);
      return;
    }
    navigateAppPath(path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setOpen(false);
  }

  return (
    <>
      <button
        className="mobile-nav-trigger"
        type="button"
        aria-label="Abrir navegação"
        aria-expanded={open}
        aria-controls="mobile-navigation-drawer"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden="true" />
      </button>

      {open && <button className="mobile-navigation-backdrop" type="button" aria-label="Fechar navegação" onClick={() => setOpen(false)} />}

      <nav
        id="mobile-navigation-drawer"
        className={`mobile-navigation-drawer ${open ? 'is-open' : ''}`}
        aria-label="Navegação principal"
        aria-hidden={!open}
      >
        <div className="mobile-navigation-drawer__brand">
          <span><Music2 aria-hidden="true" /></span>
          <div><strong>Home Music</strong><small>Sua biblioteca</small></div>
          <button type="button" aria-label="Fechar navegação" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </div>

        <div className="mobile-navigation-drawer__items">
          <button type="button" className={active === 'player' ? 'is-active' : ''} aria-current={active === 'player' ? 'page' : undefined} onClick={() => navigate(onOpenPlayer)}>
            <Radio aria-hidden="true" /><span>Tocando agora</span>
          </button>
          <div className="mobile-navigation-drawer__label">Biblioteca</div>
          <button type="button" onClick={() => navigateLibraryRoute('/library', onOpenFolders)}><Folder aria-hidden="true" /><span>Pastas</span></button>
          <button type="button" onClick={() => navigateLibraryRoute('/library/playlists', onOpenPlaylists)}><ListMusic aria-hidden="true" /><span>Playlists</span></button>
        </div>

        <button className={`mobile-navigation-drawer__account ${active === 'account' ? 'is-active' : ''}`} type="button" onClick={() => navigate(onOpenAccount)}>
          <UserRound aria-hidden="true" />
          <span><strong>Minha conta</strong>{username && <small>{username}</small>}</span>
        </button>
      </nav>
    </>
  );
}
