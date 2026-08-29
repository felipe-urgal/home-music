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

export type AdminExternalProviderBatchStatus =
  | 'ready'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AdminExternalProviderBatchItemStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'duplicate'
  | 'ignored'
  | 'failed'
  | 'cancelled';

export type AdminExternalProviderBatchItem = {
  index: number;
  sourceId: string | null;
  label: string;
  durationSeconds: number | null;
  status: AdminExternalProviderBatchItemStatus;
  jobId: string | null;
  destination: string | null;
  error: string | null;
};

export type AdminExternalProviderBatch = {
  id: string;
  providerId: string;
  label: string;
  status: AdminExternalProviderBatchStatus;
  folderPath: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  error: string | null;
  limits: {
    maxItems: number;
    maxBytes: number;
    maxDurationSeconds: number;
  };
  summary: {
    total: number;
    processed: number;
    completed: number;
    duplicates: number;
    ignored: number;
    failed: number;
    cancelled: number;
    importedBytes: number;
    importedDurationSeconds: number;
  };
  items: AdminExternalProviderBatchItem[];
};

export async function getAdminExternalProviders() {
  const response = await apiFetch('/api/admin/imports', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as {
    providers?: AdminExternalProviderDescriptor[];
    error?: string;
  } | null;
  if (!response.ok || !Array.isArray(payload?.providers)) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.providers;
}

export async function inspectAdminExternalProviderBatch(providerId: string, url: string) {
  const response = await apiFetch(`/api/admin/imports/providers/${encodeURIComponent(providerId)}/batches/inspect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ url })
  });
  const payload = await response.json().catch(() => null) as {
    batch?: AdminExternalProviderBatch | null;
    limits?: AdminExternalProviderBatch['limits'];
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  return {
    batch: payload?.batch ?? null,
    limits: payload?.limits ?? null
  };
}

export async function startAdminExternalProviderBatch(batchId: string, folderPath: string) {
  const response = await apiFetch(`/api/admin/imports/provider-batches/${encodeURIComponent(batchId)}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ folderPath })
  });
  const payload = await response.json().catch(() => null) as { batch?: AdminExternalProviderBatch; error?: string } | null;
  if (!response.ok || !payload?.batch) throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  return payload.batch;
}

export async function getAdminExternalProviderBatch(batchId: string) {
  const response = await apiFetch(`/api/admin/imports/provider-batches/${encodeURIComponent(batchId)}`, {
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => null) as { batch?: AdminExternalProviderBatch; error?: string } | null;
  if (!response.ok || !payload?.batch) throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  return payload.batch;
}

export async function cancelAdminExternalProviderBatch(batchId: string) {
  const response = await apiFetch(`/api/admin/imports/provider-batches/${encodeURIComponent(batchId)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  const payload = await response.json().catch(() => null) as { batch?: AdminExternalProviderBatch; error?: string } | null;
  if (!response.ok || !payload?.batch) throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  return payload.batch;
}

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
