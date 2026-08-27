import type { AdminTrack, AdminTracksResponse } from '@home-music/shared';
import { apiFetch } from './api-client';

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Falha HTTP ${response.status}`;
}

export async function listAdminTracks() {
  const response = await apiFetch('/api/admin/tracks', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTracksResponse>;
}

export async function setAdminTrackEnabled(trackId: string, enabled: boolean) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as { track: AdminTrack };
  return payload.track;
}
