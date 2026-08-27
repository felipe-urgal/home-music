import {
  PERMANENT_DELETE_CONFIRMATION,
  type AdminQuarantineResponse,
  type AdminQuarantinedTrack,
  type Track
} from '@home-music/shared';
import { apiFetch } from './api-client';

const mutationHeaders = { 'X-Home-Music-Request': '1' };

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Falha HTTP ${response.status}`;
}

export async function listAdminQuarantine() {
  const response = await apiFetch('/api/admin/quarantine', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminQuarantineResponse>;
}

export async function quarantineAdminTrack(trackId: string) {
  const response = await apiFetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/quarantine`, {
    method: 'POST',
    headers: mutationHeaders
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as { track: AdminQuarantinedTrack };
  return payload.track;
}

export async function restoreAdminQuarantinedTrack(trackId: string) {
  const response = await apiFetch(`/api/admin/quarantine/${encodeURIComponent(trackId)}/restore`, {
    method: 'POST',
    headers: mutationHeaders
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as { track: Track };
  return payload.track;
}

export async function deleteAdminQuarantinedTrack(trackId: string) {
  const response = await apiFetch(`/api/admin/quarantine/${encodeURIComponent(trackId)}`, {
    method: 'DELETE',
    headers: {
      ...mutationHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ confirmation: PERMANENT_DELETE_CONFIRMATION })
  });
  if (!response.ok) throw new Error(await responseError(response));

  const scanResponse = await apiFetch('/api/library/scan', {
    method: 'POST',
    headers: mutationHeaders
  }).catch(() => null);
  if (!scanResponse?.ok) {
    throw new Error('Arquivo excluído permanentemente, mas o cleanup da biblioteca não pôde ser concluído. Atualize a biblioteca.');
  }
}
