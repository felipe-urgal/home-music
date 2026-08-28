import type { FavoritesResponse, Playlist, PlaylistsResponse } from '@home-music/shared';
import { apiFetch } from './api-client';
import { notifyPlaylistsChanged } from './library-events';

const mutationHeaders = { 'X-Home-Music-Request': '1' };

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Falha HTTP ${response.status}`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  if (!response.ok) throw new Error(await responseError(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function loadCurrentUserFavoriteIds() {
  const favorites = await jsonRequest<FavoritesResponse>('/api/favorites', { cache: 'no-store' });
  return favorites.trackIds;
}

export async function loadCurrentUserManualPlaylists() {
  const response = await jsonRequest<PlaylistsResponse>('/api/playlists', { cache: 'no-store' });
  return response.playlists.filter(playlist => playlist.source === 'manual');
}

export async function favoriteCurrentUserTrack(trackId: string) {
  await jsonRequest(`/api/favorites/${encodeURIComponent(trackId)}`, {
    method: 'PUT',
    headers: {
      ...mutationHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ favorite: true })
  });
}

export async function setCurrentUserPlaylistTracks(playlist: Playlist, trackIds: string[]) {
  await jsonRequest(`/api/playlists/${encodeURIComponent(playlist.id)}/tracks`, {
    method: 'PUT',
    headers: {
      ...mutationHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trackIds })
  });
  notifyPlaylistsChanged();
}
