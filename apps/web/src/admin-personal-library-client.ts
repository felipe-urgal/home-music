import type { FavoritesResponse } from '@home-music/shared';
import { apiFetch } from './api-client';

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
