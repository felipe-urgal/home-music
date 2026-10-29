import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  AudioLines,
  ListMusic,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Disc3
} from 'lucide-react';
import type { LibraryTab } from '../useLibraryNavigation';

const DESKTOP_SIDEBAR_EXPANDED_WIDTH = 236;
const DESKTOP_SIDEBAR_COLLAPSED_WIDTH = 74;

type DesktopLayoutStyle = CSSProperties & {
  '--desktop-sidebar-width'?: string;
};

export type DesktopSection = 'player' | 'library' | 'users' | 'account';

type DesktopShellProps = {
  active: DesktopSection;
  activeLibraryTab?: LibraryTab;
  libraryCount: number;
  offlineMode?: boolean;
  canRefreshLibrary?: boolean;
  libraryRefreshing?: boolean;
  onRefreshLibrary?: () => void;
  onOpenPlayer: () => void;
  onOpenLibrary: () => void;
  onOpenDjMode?: () => void;
  onOpenLibraryTab?: (tab: LibraryTab) => void;
  sidebarUtilities?: ReactNode;
  surfaceClassName: string;
  children: ReactNode;
};

type NavigationButtonProps = {
  active: boolean;
  label: string;
  icon: ReactNode;
  nested?: boolean;
  onClick: () => void;
};

function NavigationButton({ active, label, icon, nested = false, onClick }: NavigationButtonProps) {
  return (
    <button
      className={`desktop-nav__item ${nested ? 'desktop-nav__item--nested' : ''} ${active ? 'is-active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function DesktopShell({
  active,
  activeLibraryTab,
  libraryCount,
  offlineMode = false,
  canRefreshLibrary = false,
  libraryRefreshing = false,
  onRefreshLibrary,
  onOpenPlayer,
  onOpenLibrary,
  onOpenDjMode,
  onOpenLibraryTab,
  sidebarUtilities,
  surfaceClassName,
  children
}: DesktopShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [topbarCollapsed, setTopbarCollapsed] = useState(true);
  const layoutStyle: DesktopLayoutStyle = {
    '--desktop-sidebar-width': `${sidebarCollapsed ? DESKTOP_SIDEBAR_COLLAPSED_WIDTH : DESKTOP_SIDEBAR_EXPANDED_WIDTH}px`
  };

  return (
    <div
      className="desktop-layout"
      data-desktop-active={active}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
      data-topbar-collapsed={topbarCollapsed ? 'true' : 'false'}
      data-library-tab={activeLibraryTab}
      data-offline={offlineMode ? 'true' : 'false'}
      style={layoutStyle}
    >
      <header
        id="desktop-topbar"
        className={`desktop-sidebar desktop-topbar ${sidebarUtilities ? 'has-utilities' : ''}`}
        data-testid="desktop-sidebar"
        aria-hidden={topbarCollapsed && !offlineMode ? true : undefined}
        inert={topbarCollapsed && !offlineMode ? true : undefined}
      >
        <button
          className="desktop-sidebar__collapse"
          type="button"
          aria-label={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
          title={sidebarCollapsed ? 'Expandir navegação' : 'Recolher navegação'}
          aria-pressed={sidebarCollapsed}
          onClick={() => setSidebarCollapsed(value => !value)}
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>

        <button
          className={`desktop-brand ${active === 'player' ? 'is-active' : ''}`}
          type="button"
          aria-label="Abrir Tocando Agora"
          aria-current={active === 'player' ? 'page' : undefined}
          title="Tocando Agora"
          onClick={onOpenPlayer}
        >
          <span className="desktop-brand__icon"><AudioLines /></span>
          <span className="desktop-brand__copy">
            <strong>Home Music</strong>
            <small>{offlineMode ? 'Modo offline' : 'Sua biblioteca'}</small>
          </span>
        </button>

        <nav className="desktop-nav" aria-label="Navegação principal">
          {offlineMode || !onOpenLibraryTab ? (
            <NavigationButton active={active === 'library'} label={offlineMode ? 'Downloads' : 'Biblioteca'} icon={<ListMusic />} onClick={onOpenLibrary} />
          ) : (
            <div className="desktop-nav__group" aria-label="Biblioteca">
              <div className="desktop-nav__group-heading">
                <span className="desktop-nav__group-label">Biblioteca</span>
                {canRefreshLibrary && onRefreshLibrary && (
                  <button
                    className={`desktop-nav__refresh ${libraryRefreshing ? 'is-loading' : ''}`}
                    type="button"
                    aria-label="Atualizar biblioteca"
                    title="Atualizar biblioteca"
                    disabled={libraryRefreshing}
                    onClick={onRefreshLibrary}
                  >
                    <RefreshCw aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}
        </nav>

        <div className="desktop-topbar__actions">
          {onOpenDjMode && (
            <button
              className="desktop-topbar__search"
              type="button"
              aria-label="Abrir Modo DJ"
              title="Modo DJ"
              onClick={onOpenDjMode}
            >
              <Disc3 aria-hidden="true" />
            </button>
          )}
          <button
            className="desktop-topbar__search"
            type="button"
            aria-label="Buscar na biblioteca"
            title="Buscar na biblioteca"
            onClick={() => {
              if (onOpenLibraryTab) onOpenLibraryTab('folders');
              else onOpenLibrary();
              window.requestAnimationFrame(() => {
                document.querySelector<HTMLInputElement>('.search-box--library input')?.focus();
              });
            }}
          >
            <Search aria-hidden="true" />
          </button>
          {sidebarUtilities && <div className="desktop-sidebar__utilities">{sidebarUtilities}</div>}
        </div>
      </header>

      {!offlineMode && (
        <button
          className="desktop-topbar__collapse-toggle"
          type="button"
          aria-controls="desktop-topbar"
          aria-expanded={!topbarCollapsed}
          aria-label={topbarCollapsed ? 'Expandir barra superior' : 'Recolher barra superior'}
          title={topbarCollapsed ? 'Expandir barra superior' : 'Recolher barra superior'}
          onClick={() => setTopbarCollapsed(value => !value)}
        >
          <span aria-hidden="true" />
        </button>
      )}

      <section className={surfaceClassName} data-desktop-section={active}>
        <div className={`desktop-main-content desktop-main-content--${active}`}>{children}</div>
      </section>
    </div>
  );
}
