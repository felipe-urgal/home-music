import type {
  AdminTrack,
  AdminTrackCoverResponse,
  AdminTrackMetadataResponse,
  AdminTracksResponse,
  TrackMetadataOverridePatch
} from '@home-music/shared';
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
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as { track: AdminTrack };
  return payload.track;
}

export async function getAdminTrackMetadata(trackId: string) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackMetadataResponse>;
}

export async function updateAdminTrackMetadata(trackId: string, patch: TrackMetadataOverridePatch) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackMetadataResponse>;
}

export async function resetAdminTrackMetadata(trackId: string) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackMetadataResponse>;
}

export async function getAdminTrackCover(trackId: string) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/cover`, {
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackCoverResponse>;
}

export async function updateAdminTrackCover(trackId: string, file: File) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/cover`, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
      'X-Home-Music-Request': '1'
    },
    body: file
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackCoverResponse>;
}

export async function resetAdminTrackCover(trackId: string) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/cover`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackCoverResponse>;
}
