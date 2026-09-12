import { useEffect, useRef, useState } from 'react';
import { Folder, ListMusic, Menu, Music2, Radio, UserRound, X } from 'lucide-react';
import { navigateAppPath } from '../browser-navigation';

const DRAWER_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

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
  onOpenFolders,
  onOpenPlaylists,
  onOpenAccount
}: MobileBottomNavProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    setOpen(false);
  }, [active]);

  useEffect(() => {
    if (!open) {
      if (!wasOpenRef.current) return;
      wasOpenRef.current = false;
      const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }

    wasOpenRef.current = true;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !drawer.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !drawer.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
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
        ref={triggerRef}
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
        ref={drawerRef}
        id="mobile-navigation-drawer"
        className={`mobile-navigation-drawer ${open ? 'is-open' : ''}`}
        aria-label="Navegação principal"
        aria-hidden={!open}
      >
        <div className="mobile-navigation-drawer__brand">
          <span><Music2 aria-hidden="true" /></span>
          <div><strong>Home Music</strong><small>Sua biblioteca</small></div>
          <button ref={closeButtonRef} type="button" aria-label="Fechar navegação" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
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
