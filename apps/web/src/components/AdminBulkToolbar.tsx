import { useEffect, useRef, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';

type AdminBulkToolbarProps = {
  selectedCount: number;
  allVisibleSelected: boolean;
  mixedVisibleSelection: boolean;
  busy: boolean;
  completed: number;
  total: number;
  onToggleVisible: () => void;
  onClear: () => void;
  children: ReactNode;
};

export function AdminBulkToolbar({
  selectedCount,
  allVisibleSelected,
  mixedVisibleSelection,
  busy,
  completed,
  total,
  onToggleVisible,
  onClear,
  children
}: AdminBulkToolbarProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = mixedVisibleSelection;
  }, [mixedVisibleSelection]);

  return (
    <section className="admin-bulk-toolbar" aria-label="Ações em lote" data-testid="admin-bulk-toolbar">
      <label className="admin-bulk-toolbar__selection">
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allVisibleSelected}
          disabled={busy}
          aria-label="Selecionar todas as músicas visíveis"
          onChange={onToggleVisible}
        />
        <span>{selectedCount} selecionada{selectedCount === 1 ? '' : 's'}</span>
      </label>

      <div className="admin-bulk-toolbar__actions">
        {children}
      </div>

      <div className="admin-bulk-toolbar__status" aria-live="polite">
        {busy && (
          <span role="status">
            <LoaderCircle className="is-spinning" />
            {completed}/{total}
          </span>
        )}
        <button type="button" disabled={busy} aria-label="Limpar seleção" onClick={onClear}><X /></button>
      </div>
    </section>
  );
}
