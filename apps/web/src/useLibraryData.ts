import { useCallback, useEffect, useState } from 'react';
import type {
  LibraryResponse,
  Playlist,
  PlaylistsResponse,
  ScanResponse,
  SmartPlaylistPreviewResponse,
  SmartPlaylistResponse,
  SmartPlaylistRule,
  Track
} from '@home-music/shared';
import { apiFetch } from './api-client';
import { LIBRARY_CHANGED_EVENT, PLAYLISTS_CHANGED_EVENT } from './library-events';

const LIBRARY_STATUS_POLL_MS = 15_000;

type LibraryPayload = LibraryResponse & {
  revision?: number;
};

type LibraryStatusPayload = {
  scannedAt: string;
  scanning: boolean;
  revision: number;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-Home-Music-Request', '1');

  const response = await apiFetch(url, { ...init, headers });
  if (!response.ok) {
    const message = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(message?.error || `Falha HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function sortPlaylists(playlists: Playlist[]) {
  return [...playlists].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
    || left.name.localeCompare(right.name, 'pt-BR')
    || left.id.localeCompare(right.id)
  );
}

export function useLibraryData() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [scannedAt, setScannedAt] = useState('');
  const [revision, setRevision] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reportError = useCallback((error: unknown) => setActionError(errorMessage(error)), []);
  const clearActionError = useCallback(() => setActionError(null), []);

  useEffect(() => {
    if (!actionError) return;
    const timeout = window.setTimeout(() => setActionError(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [actionError]);

  const refreshLibrary = useCallback(async () => {
    const data = await jsonRequest<LibraryPayload>('/api/library');
    setTracks(data.tracks);
    setScannedAt(data.scannedAt);
    setScanning(data.scanning);
    setRevision(Number.isInteger(data.revision) ? Number(data.revision) : 0);
    return data;
  }, []);

  const refreshPlaylists = useCallback(async () => {
    const [regular, smart] = await Promise.all([
      jsonRequest<PlaylistsResponse>('/api/playlists'),
      jsonRequest<PlaylistsResponse>('/api/smart-playlists')
    ]);
    const merged = sortPlaylists([...regular.playlists, ...smart.playlists]);
    setPlaylists(merged);
    return { playlists: merged } satisfies PlaylistsResponse;
  }, []);

  useEffect(() => {
    const onPlaylistsChanged = () => {
      void refreshPlaylists().catch(reportError);
    };
    window.addEventListener(PLAYLISTS_CHANGED_EVENT, onPlaylistsChanged);
    return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, onPlaylistsChanged);
  }, [refreshPlaylists, reportError]);

  useEffect(() => {
    const onLibraryChanged = () => {
      void refreshLibrary().catch(reportError);
    };
    window.addEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onLibraryChanged);
  }, [refreshLibrary, reportError]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshLibrary(), refreshPlaylists()]);
  }, [refreshLibrary, refreshPlaylists]);

  const retry = useCallback(async () => {
    setLoading(true);
    try {
      await refreshAll();
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
      throw error;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  useEffect(() => {
    void retry().catch(() => undefined);
  }, [retry]);

  useEffect(() => {
    if (loading || error) return;

    let disposed = false;
    let refreshing = false;

    const checkStatus = async () => {
      if (disposed || refreshing || document.visibilityState === 'hidden') return;

      try {
        const status = await jsonRequest<LibraryStatusPayload>('/api/library/status');
        if (disposed) return;

        setScanning(status.scanning);
        setScannedAt(status.scannedAt);

        if (status.revision !== revision) {
          refreshing = true;
          try {
            await refreshAll();
          } finally {
            refreshing = false;
          }
        }
      } catch {
        // Polling em background é best-effort. 401 já é tratado globalmente por apiFetch.
      }
    };

    const interval = window.setInterval(() => { void checkStatus(); }, LIBRARY_STATUS_POLL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkStatus();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [error, loading, refreshAll, revision]);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await jsonRequest<ScanResponse>('/api/library/scan', { method: 'POST' });
      await refreshAll();
      setActionError(null);
      return result;
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setScanning(false);
    }
  }, [refreshAll, reportError]);

  const createPlaylist = useCallback(async (name: string) => {
    try {
      await jsonRequest('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      await refreshPlaylists();
      setActionError(null);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    try {
      await jsonRequest(`/api/playlists/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      await refreshPlaylists();
      setActionError(null);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const deletePlaylist = useCallback(async (id: string) => {
    try {
      await jsonRequest(`/api/playlists/${id}`, { method: 'DELETE' });
      await refreshPlaylists();
      setActionError(null);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const previewSmartPlaylist = useCallback(async (rule: SmartPlaylistRule) => {
    try {
      const result = await jsonRequest<SmartPlaylistPreviewResponse>('/api/smart-playlists/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule })
      });
      setActionError(null);
      return result.trackIds;
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [reportError]);

  const createSmartPlaylist = useCallback(async (name: string, rule: SmartPlaylistRule) => {
    try {
      const result = await jsonRequest<SmartPlaylistResponse>('/api/smart-playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rule })
      });
      await refreshPlaylists();
      setActionError(null);
      return result.playlist;
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const updateSmartPlaylist = useCallback(async (
    id: string,
    patch: { name?: string; rule?: SmartPlaylistRule }
  ) => {
    try {
      const result = await jsonRequest<SmartPlaylistResponse>(`/api/smart-playlists/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      await refreshPlaylists();
      setActionError(null);
      return result.playlist;
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const deleteSmartPlaylist = useCallback(async (id: string) => {
    try {
      await jsonRequest(`/api/smart-playlists/${id}`, { method: 'DELETE' });
      await refreshPlaylists();
      setActionError(null);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const setPlaylistTracks = useCallback(async (id: string, trackIds: string[]) => {
    try {
      await jsonRequest(`/api/playlists/${id}/tracks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds })
      });
      await refreshPlaylists();
      setActionError(null);
    } catch (error) {
      reportError(error);
      throw error;
    }
  }, [refreshPlaylists, reportError]);

  const addTrackToPlaylist = useCallback(async (playlist: Playlist, trackId: string) => {
    const trackIds = playlist.trackIds.includes(trackId)
      ? playlist.trackIds
      : [...playlist.trackIds, trackId];
    await setPlaylistTracks(playlist.id, trackIds);
  }, [setPlaylistTracks]);

  return {
    tracks,
    playlists,
    scannedAt,
    scanning,
    loading,
    error,
    actionError,
    reportError,
    clearActionError,
    retry,
    rescan,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    previewSmartPlaylist,
    createSmartPlaylist,
    updateSmartPlaylist,
    deleteSmartPlaylist,
    setPlaylistTracks,
    addTrackToPlaylist
  };
}

export type LibraryData = ReturnType<typeof useLibraryData>;