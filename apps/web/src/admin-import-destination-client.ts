import type { ImportJob } from '@home-music/shared';
import { apiFetch } from './api-client';

export type AdminImportDestinationPlan = {
  folderPath: string;
  fileName: string;
  relativePath: string;
  collisionIndex: number;
};

export type AdminImportPromotionResult = {
  job: ImportJob;
  destination: AdminImportDestinationPlan;
};

export async function getAdminImportDestination(jobId: string, folderPath?: string) {
  const query = new URLSearchParams();
  if (folderPath !== undefined) query.set('folderPath', folderPath);
  const encodedQuery = query.toString();
  const suffix = encodedQuery ? `?${encodedQuery}` : '';
  const response = await apiFetch(`/api/admin/imports/${encodeURIComponent(jobId)}/destination${suffix}`, {
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => null) as {
    destination?: AdminImportDestinationPlan;
    error?: string;
  } | null;
  if (!response.ok || !payload?.destination) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.destination;
}

export async function promoteAdminImport(jobId: string, folderPath?: string) {
  const response = await apiFetch(`/api/admin/imports/${encodeURIComponent(jobId)}/promote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(folderPath === undefined ? {} : { folderPath })
  });
  const payload = await response.json().catch(() => null) as {
    job?: ImportJob;
    destination?: AdminImportDestinationPlan;
    error?: string;
  } | null;
  if (!response.ok || !payload?.job || !payload.destination) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload as AdminImportPromotionResult;
}
