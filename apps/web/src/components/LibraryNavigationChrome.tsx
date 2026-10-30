import { ChevronLeft, ChevronRight, MoreVertical, Music2, RefreshCw } from 'lucide-react';
import type { LibraryNavigation } from '../useLibraryNavigation';

type LibraryNavigationChromeProps = {
  navigation: LibraryNavigation;
  isDetail: boolean;
  title: string;
  subtitle: string;
  canManageSharedLibrary: boolean;
  scanning: boolean;
  onBack: () => void;
  onScan: () => void;
  onOpenPlayer: () => void;
  detailMenuOpen?: boolean;
  onToggleDetailMenu?: () => void;
};

export function LibraryNavigationChrome({
  navigation,
  isDetail,
  title,
  subtitle,
  canManageSharedLibrary,
  scanning,
  onBack,
  onScan,
  onOpenPlayer,
  detailMenuOpen = false,
  onToggleDetailMenu
}: LibraryNavigationChromeProps) {
  const { libraryTab, folderView, visibleFolders, enterFolder } = navigation;

  return (
    <>
      <header className={`library-header ${isDetail ? 'is-detail' : 'is-root'}`}>
        {isDetail ? (
          <button className="icon-button library-header__back" type="button" aria-label="Biblioteca" onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
            <span className="library-header__back-label">Biblioteca</span>
          </button>
        ) : (
          <span className="library-header__spacer" />
        )}
        <div className="library-header__title">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        {!isDetail && libraryTab === 'folders' && (
          <div className="library-header__folder-meta">
            <span>{visibleFolders.length} {visibleFolders.length === 1 ? 'pasta' : 'pastas'}</span>
          </div>
        )}
        {canManageSharedLibrary && (
          <button className={`icon-button ${scanning ? 'is-loading' : ''}`} type="button" aria-label="Atualizar biblioteca" disabled={scanning} onClick={onScan}><RefreshCw aria-hidden="true" /></button>
        )}
        {isDetail && onToggleDetailMenu && (
          <button
            className="icon-button library-header__more"
            type="button"
            aria-label="Mais opções da coleção"
            aria-haspopup="dialog"
            aria-expanded={detailMenuOpen}
            onClick={onToggleDetailMenu}
          >
            <MoreVertical aria-hidden="true" />
          </button>
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
    </>
  );
}