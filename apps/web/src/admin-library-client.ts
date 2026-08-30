import type { AdminLibraryOverviewResponse, ScanResponse } from '@home-music/shared';
import { apiFetch } from './api-client';

export type {
  AdminLibraryIntegrityIssue,
  AdminLibraryIntegrityIssueKind,
  AdminLibraryIntegrityStatus,
  AdminLibraryProblemKey
} from '@home-music/shared';
export type AdminLibraryHealthOverview = AdminLibraryOverviewResponse;

export type AdminTranscodeCacheStatus = {
  bytes: number;
  limitBytes: number;
  entries: number;
  temporaryEntries: number;
  active: number;
  pending: number;
};

export type AdminTranscodeCacheClearResponse = {
  freedBytes: number;
  removedEntries: number;
  failedEntries: number;
  cache: AdminTranscodeCacheStatus;
};

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Falha HTTP ${response.status}`;
}

export async function getAdminLibraryOverview() {
  const response = await apiFetch('/api/admin/library/overview', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryOverviewResponse>;
}

export async function rescanLibrary() {
  const response = await apiFetch('/api/library/scan', {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<ScanResponse>;
}

export async function getAdminTranscodeCache() {
  const response = await apiFetch('/api/admin/transcoding/cache', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTranscodeCacheStatus>;
}

export async function clearAdminTranscodeCache() {
  const response = await apiFetch('/api/admin/transcoding/cache', {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTranscodeCacheClearResponse>;
}
