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

export function useLibraryViews(reportError: (error: unknown) => void) {
  const [views, setViews] = useState<SavedLibraryView[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const result = await jsonRequest<LibraryViewsResponse>('/api/library-views');
    if (sequence !== refreshSequence.current) return result;
    setViews(sortViews(result.views));
    return result;
  }, []);

  useEffect(() => {
    let disposed = false;
    void refresh()
      .catch(error => {
        if (!disposed) reportError(error);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      refreshSequence.current += 1;
    };
  }, [refresh, reportError]);

  const createView = useCallback(async (name: string, definition: LibraryViewDefinition) => {
    try {
      const result = await jsonRequest<LibraryViewResponse>('/api/library-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, definition })
      });
      await refresh();
      return result.view;
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refresh, reportError]);

  const renameView = useCallback(async (id: string, name: string) => {
    try {
      const result = await jsonRequest<LibraryViewResponse>(`/api/library-views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      await refresh();
      return result.view;
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refresh, reportError]);

  const deleteView = useCallback(async (id: string) => {
    try {
      await jsonRequest(`/api/library-views/${id}`, { method: 'DELETE' });
      await refresh();
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refresh, reportError]);

  return {
    views,
    loading,
    refresh,
    createView,
    renameView,
    deleteView
  };
}

export type LibraryViews = ReturnType<typeof useLibraryViews>;
