import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api-client';
import type {
  LibraryViewDefinition,
  LibraryViewResponse,
  LibraryViewsResponse,
  SavedLibraryView
} from './library-view-types';

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-Home-Music-Request', '1');

  const response = await apiFetch(url, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function sortViews(views: SavedLibraryView[]) {
  return [...views].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
    || left.name.localeCompare(right.name, 'pt-BR')
    || left.id.localeCompare(right.id)
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível carregar as views inteligentes.';
}

export function useLibraryViews(reportError: (error: unknown) => void) {
  const [views, setViews] = useState<SavedLibraryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const result = await jsonRequest<LibraryViewsResponse>('/api/library-views');
      if (!mounted.current || sequence !== refreshSequence.current) return result;
      setViews(sortViews(result.views));
      setError(null);
      return result;
    } catch (caught) {
      if (mounted.current && sequence === refreshSequence.current) setError(errorMessage(caught));
      throw caught;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh()
      .catch(caught => {
        if (mounted.current) reportError(caught);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
    };
  }, [refresh, reportError]);

  const reconcile = useCallback(async () => {
    if (!mounted.current) return;
    try {
      await refresh();
    } catch (caught) {
      if (mounted.current) reportError(caught);
    }
  }, [refresh, reportError]);

  const createView = useCallback(async (name: string, definition: LibraryViewDefinition) => {
    let result: LibraryViewResponse;
    try {
      result = await jsonRequest<LibraryViewResponse>('/api/library-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, definition })
      });
    } catch (caught) {
      reportError(caught);
      throw caught;
    }

    if (mounted.current) {
      setViews(current => sortViews([
        result.view,
        ...current.filter(view => view.id !== result.view.id)
      ]));
      setError(null);
    }
    await reconcile();
    return result.view;
  }, [reconcile, reportError]);

  const renameView = useCallback(async (id: string, name: string) => {
    let result: LibraryViewResponse;
    try {
      result = await jsonRequest<LibraryViewResponse>(`/api/library-views/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch (caught) {
      reportError(caught);
      throw caught;
    }

    if (mounted.current) {
      setViews(current => sortViews(current.map(view => view.id === id ? result.view : view)));
      setError(null);
    }
    await reconcile();
    return result.view;
  }, [reconcile, reportError]);

  const deleteView = useCallback(async (id: string) => {
    try {
      await jsonRequest(`/api/library-views/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (caught) {
      reportError(caught);
      throw caught;
    }

    if (mounted.current) {
      setViews(current => current.filter(view => view.id !== id));
      setError(null);
    }
    await reconcile();
  }, [reconcile, reportError]);

  return {
    views,
    loading,
    error,
    refresh,
    createView,
    renameView,
    deleteView
  };
}

export type LibraryViews = ReturnType<typeof useLibraryViews>;
