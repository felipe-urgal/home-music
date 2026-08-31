import { BookmarkPlus, Pencil, Search, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import type { CoverFilter, TrackSort } from '../library-utils';
import type { LibraryNavigation } from '../useLibraryNavigation';
import type { LibraryViews } from '../useLibraryViews';

type LibraryViewToolsProps = {
  navigation: LibraryNavigation;
  savedViews: LibraryViews;
  open: boolean;
  onToggleOpen: () => void;
  onSaveCurrentView: () => Promise<void>;
  onRenameSavedView: (id: string, currentName: string) => Promise<void>;
  onRemoveSavedView: (id: string, name: string) => Promise<void>;
  reportError: (error: unknown) => void;
};

export function LibraryViewTools({
  navigation,
  savedViews,
  open,
  onToggleOpen,
  onSaveCurrentView,
  onRenameSavedView,
  onRemoveSavedView,
  reportError
}: LibraryViewToolsProps) {
  const {
    query,
    sort,
    formatFilter,
    coverFilter,
    availableFormats,
    activeViewOptionCount,
    canSortTracks,
    applyLibraryView,
    changeQuery,
    changeSort,
    changeFormatFilter,
    changeCoverFilter,
    resetViewOptions
  } = navigation;
  const run = (operation: Promise<unknown>) => void operation.catch(() => undefined);

  return (
    <section className="library-smart-view-tools" aria-label="Busca, filtros e views inteligentes">
      <div className="library-tools">
        <label className="search-box search-box--library">
          <Search aria-hidden="true" />
          <span className="sr-only">Buscar na biblioteca</span>
          <input
            value={query}
            onChange={event => changeQuery(event.target.value)}
            placeholder="Música, artista, álbum ou pasta"
          />
        </label>
        <button
          className={`library-filter-toggle ${activeViewOptionCount > 0 ? 'is-active' : ''}`}
          type="button"
          aria-label="Ordenar, filtrar e gerenciar views"
          aria-expanded={open}
          onClick={onToggleOpen}
        >
          <SlidersHorizontal aria-hidden="true" />
          {activeViewOptionCount > 0 && <span>{activeViewOptionCount}</span>}
        </button>
      </div>

      {savedViews.views.length > 0 && (
        <div className="library-saved-view-strip" aria-label="Views salvas">
          {savedViews.views.map(view => (
            <button key={view.id} type="button" onClick={() => applyLibraryView(view.definition)}>
              <Sparkles aria-hidden="true" />
              <span>{view.name}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="library-view-controls">
          {canSortTracks && (
            <label>
              <span>Ordenar</span>
              <select value={sort} onChange={event => changeSort(event.target.value as TrackSort)}>
                <option value="current">Ordem atual</option>
                <option value="title-asc">Título A–Z</option>
                <option value="title-desc">Título Z–A</option>
                <option value="artist-asc">Artista A–Z</option>
                <option value="artist-desc">Artista Z–A</option>
                <option value="album-asc">Álbum A–Z</option>
                <option value="album-desc">Álbum Z–A</option>
              </select>
            </label>
          )}

          <label>
            <span>Formato</span>
            <select value={formatFilter} onChange={event => changeFormatFilter(event.target.value)}>
              <option value="all">Todos</option>
              {availableFormats.map(format => <option key={format} value={format}>{format}</option>)}
            </select>
          </label>

          <label>
            <span>Capa</span>
            <select value={coverFilter} onChange={event => changeCoverFilter(event.target.value as CoverFilter)}>
              <option value="all">Todas</option>
              <option value="with-cover">Com capa</option>
              <option value="without-cover">Sem capa</option>
            </select>
          </label>

          <div className="library-view-controls__actions">
            <button type="button" onClick={() => run(onSaveCurrentView())}><BookmarkPlus />Salvar view</button>
            {(query || activeViewOptionCount > 0) && (
              <button type="button" onClick={() => { changeQuery(''); resetViewOptions(); }}>Limpar</button>
            )}
          </div>

          {savedViews.loading ? (
            <div className="library-saved-view-status">Carregando views…</div>
          ) : savedViews.error ? (
            <div className="library-saved-view-status is-error" role="alert">
              <span>{savedViews.error}</span>
              <button type="button" onClick={() => void savedViews.refresh().catch(reportError)}>Tentar novamente</button>
            </div>
          ) : savedViews.views.length > 0 ? (
            <div className="library-saved-view-manager">
              <span className="library-saved-view-manager__title">Views salvas</span>
              {savedViews.views.map(view => (
                <div className="library-saved-view-row" key={view.id}>
                  <button className="library-saved-view-row__open" type="button" onClick={() => applyLibraryView(view.definition)}>
                    <Sparkles aria-hidden="true" />
                    <span>{view.name}</span>
                  </button>
                  <button type="button" aria-label={`Renomear view ${view.name}`} onClick={() => run(onRenameSavedView(view.id, view.name))}><Pencil /></button>
                  <button className="is-danger" type="button" aria-label={`Excluir view ${view.name}`} onClick={() => run(onRemoveSavedView(view.id, view.name))}><Trash2 /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="library-saved-view-status">Salve a busca e os filtros atuais para reutilizar depois.</div>
          )}
        </div>
      )}
    </section>
  );
}
