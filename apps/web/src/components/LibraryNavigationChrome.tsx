import { ChevronLeft, ChevronRight, Folder, ListMusic, Music2, RefreshCw } from 'lucide-react';
import type { LibraryNavigation, LibraryTab } from '../useLibraryNavigation';

const tabs: Array<{ id: LibraryTab; label: string; icon: typeof Folder }> = [
  { id: 'folders', label: 'Pastas', icon: Folder },
  { id: 'playlists', label: 'Playlists', icon: ListMusic }
];

type LibraryNavigationChromeProps = {
  navigation: LibraryNavigation;
  isDetail: boolean;
  title: string;
  subtitle: string;
  canManageSharedLibrary: boolean;
  scanning: boolean;
  onBack: () => void;
  onChangeTab: (tab: LibraryTab) => void;
  onScan: () => void;
  onOpenPlayer: () => void;
};

export function LibraryNavigationChrome({
  navigation,
  isDetail,
  title,
  subtitle,
  canManageSharedLibrary,
  scanning,
  onBack,
  onChangeTab,
  onScan,
  onOpenPlayer
}: LibraryNavigationChromeProps) {
  const { libraryTab, folderView, enterFolder } = navigation;

  return (
    <>
      <header className={`library-header ${isDetail ? 'is-detail' : 'is-root'}`}>
        {isDetail ? (
          <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft aria-hidden="true" /></button>
        ) : (
          <span className="library-header__spacer" />
        )}
        <div className="library-header__title">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        {canManageSharedLibrary && (
          <button className={`icon-button ${scanning ? 'is-loading' : ''}`} type="button" aria-label="Atualizar biblioteca" disabled={scanning} onClick={onScan}><RefreshCw aria-hidden="true" /></button>
        )}
        <button className="icon-button library-header__player-button" type="button" aria-label="Voltar ao player" onClick={onOpenPlayer}><Music2 aria-hidden="true" /></button>
      </header>

      {libraryTab === 'folders' && folderView.breadcrumbs.length > 0 && (
        <nav className="breadcrumbs" aria-label="Caminho da pasta">
          <button type="button" onClick={() => enterFolder('')}>Pastas</button>
          {folderView.breadcrumbs.map(crumb => (
            <span key={crumb.path}><ChevronRight aria-hidden="true" /><button type="button" onClick={() => enterFolder(crumb.path)}>{crumb.name}</button></span>
          ))}
        </nav>
      )}

      {!isDetail && (
        <nav className="library-tabs" aria-label="Navegação da biblioteca">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = libraryTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={active ? 'is-active' : ''}
                aria-current={active ? 'page' : undefined}
                onClick={() => onChangeTab(tab.id)}
              >
                <Icon aria-hidden="true" />{tab.label}
              </button>
            );
          })}
        </nav>
      )}
    </>
  );
}