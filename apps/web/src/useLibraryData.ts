import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  FavoritesResponse,
  HistoryResponse,
  LibraryResponse,
  Playlist,
  PlaylistsResponse,
  ScanResponse,
  Track
} from '@home-music/shared';

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(message?.error || `Falha HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function useLibraryData() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryResponse['items']>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [scannedAt, setScannedAt] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const refreshLibrary = useCallback(async () => {
    const data = await jsonRequest<LibraryResponse>('/api/library');
    setTracks(data.tracks);
    setScannedAt(data.scannedAt);
    setScanning(data.scanning);
    return data;
  }, []);

  const refreshFavorites = useCallback(async () => {
    const data = await jsonRequest<FavoritesResponse>('/api/favorites');
    setFavoriteIds(data.trackIds);
    return data;
  }, []);

  const refreshHistory = useCallback(async () => {
    const data = await jsonRequest<HistoryResponse>('/api/history?limit=300');
    setHistory(data.items);
    return data;
  }, []);

  const refreshPlaylists = useCallback(async () => {
    const data = await jsonRequest<PlaylistsResponse>('/api/playlists');
    setPlaylists(data.playlists);
    return data;
  }, []);

  useEffect(() => {
    Promise.all([refreshLibrary(), refreshFavorites(), refreshHistory(), refreshPlaylists()])
      .then(() => setError(null))
      .catch(error => setError(error instanceof Error ? error.message : 'Não consegui carregar a biblioteca.'))
      .finally(() => setLoading(false));
  }, [refreshFavorites, refreshHistory, refreshLibrary, refreshPlaylists]);

  const toggleFavorite = useCallback(async (trackId: string) => {
    const favorite = !favoriteSet.has(trackId);
    setFavoriteIds(items => favorite
      ? [trackId, ...items.filter(id => id !== trackId)]
      : items.filter(id => id !== trackId)
    );

    try {
      await jsonRequest(`/api/favorites/${trackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite })
      });
    } catch (error) {
      await refreshFavorites().catch(() => undefined);
      throw error;
    }
  }, [favoriteSet, refreshFavorites]);

  const rescan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await jsonRequest<ScanResponse>('/api/library/scan', { method: 'POST' });
      await Promise.all([refreshLibrary(), refreshFavorites(), refreshHistory(), refreshPlaylists()]);
      return result;
    } finally {
      setScanning(false);
    }
  }, [refreshFavorites, refreshHistory, refreshLibrary, refreshPlaylists]);

  const clearHistory = useCallback(async () => {
    await jsonRequest('/api/history', { method: 'DELETE' });
    setHistory([]);
  }, []);

  const createPlaylist = useCallback(async (name: string) => {
    await jsonRequest('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    await refreshPlaylists();
  }, [refreshPlaylists]);

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    await jsonRequest(`/api/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    await refreshPlaylists();
  }, [refreshPlaylists]);

  const deletePlaylist = useCallback(async (id: string) => {
    await jsonRequest(`/api/playlists/${id}`, { method: 'DELETE' });
    await refreshPlaylists();
  }, [refreshPlaylists]);

  const setPlaylistTracks = useCallback(async (id: string, trackIds: string[]) => {
    await jsonRequest(`/api/playlists/${id}/tracks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackIds })
    });
    await refreshPlaylists();
  }, [refreshPlaylists]);

  const addTrackToPlaylist = useCallback(async (playlist: Playlist, trackId: string) => {
    const trackIds = playlist.trackIds.includes(trackId)
      ? playlist.trackIds
      : [...playlist.trackIds, trackId];
    await setPlaylistTracks(playlist.id, trackIds);
  }, [setPlaylistTracks]);

  return {
    tracks,
    favoriteIds,
    favoriteSet,
    history,
    playlists,
    scannedAt,
    scanning,
    loading,
    error,
    refreshHistory,
    toggleFavorite,
    rescan,
    clearHistory,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    setPlaylistTracks,
    addTrackToPlaylist
  };
}

export type LibraryData = ReturnType<typeof useLibraryData>;
