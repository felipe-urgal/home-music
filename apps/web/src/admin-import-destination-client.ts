import type { ImportJob, LibraryResponse } from '@home-music/shared';
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

export type AdminImportDestinationFolder = {
  path: string;
  name: string;
  trackCount: number;
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

export async function getAdminImportDestinationFolders() {
  const response = await apiFetch('/api/library', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as LibraryResponse | { error?: string } | null;
  if (!response.ok || !payload || !('tracks' in payload)) {
    const error = payload && 'error' in payload ? payload.error : null;
    throw new Error(error || `Falha HTTP ${response.status}`);
  }

  const counts = new Map<string, number>();
  for (const track of payload.tracks) {
    const folderPath = track.folderPath?.trim();
    if (!folderPath) continue;
    counts.set(folderPath, (counts.get(folderPath) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([folderPath, trackCount]) => ({
      path: folderPath,
      name: folderPath.split('/').filter(Boolean).at(-1) || folderPath,
      trackCount
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { sensitivity: 'base', numeric: true }));
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
