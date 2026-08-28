import { useEffect, useMemo, useState } from 'react';

type Identifiable = { id: string };

export function useAdminBulkSelection<T extends Identifiable>(
  items: readonly T[],
  visibleItems: readonly T[]
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const itemIds = useMemo(() => new Set(items.map(item => item.id)), [items]);
  const visibleIds = useMemo(() => visibleItems.map(item => item.id), [visibleItems]);
  const selectedItems = useMemo(
    () => items.filter(item => selectedIds.has(item.id)),
    [items, selectedIds]
  );
  const visibleSelectedCount = useMemo(
    () => visibleIds.reduce((count, id) => count + (selectedIds.has(id) ? 1 : 0), 0),
    [selectedIds, visibleIds]
  );
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const mixedVisibleSelection = visibleSelectedCount > 0 && !allVisibleSelected;

  useEffect(() => {
    setSelectedIds(current => {
      const next = new Set([...current].filter(id => itemIds.has(id)));
      if (next.size === current.size && [...next].every(id => current.has(id))) return current;
      return next;
    });
  }, [itemIds]);

  function toggle(id: string) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelectedIds(current => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }

  function clear() {
    setSelectedIds(new Set());
  }

  function retain(ids: Iterable<string>) {
    setSelectedIds(new Set(ids));
  }

  return {
    selectedIds,
    selectedItems,
    allVisibleSelected,
    mixedVisibleSelection,
    toggle,
    toggleVisible,
    clear,
    retain
  };
}
