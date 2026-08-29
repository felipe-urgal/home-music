import type { ImportJob } from '@home-music/shared';
import { apiFetch } from './api-client';

export type AdminExternalProviderDescriptor = {
  id: string;
  label: string;
  capabilities: {
    audio: boolean;
    metadata: boolean;
    thumbnail: boolean;
    playlists: boolean;
  };
  configured: boolean;
};

export async function startAdminExternalProvider(providerId: string, url: string) {
  const response = await apiFetch(`/api/admin/imports/providers/${encodeURIComponent(providerId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ url })
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.job;
}

export async function cancelAdminExternalProvider(jobId: string) {
  const response = await apiFetch(`/api/admin/imports/providers/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.job;
}
