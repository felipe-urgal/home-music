import type {
  AdminLibraryDuplicateIgnoreRequest,
  AdminLibraryDuplicateIgnoreResponse,
  AdminLibraryDuplicateReviewResponse,
  AdminLibraryNormalizationAssociateRequest,
  AdminLibraryNormalizationReviewResponse,
  AdminLibraryOverviewResponse
} from '@home-music/shared';
import { apiFetch } from './api-client';

export type {
  AdminLibraryDuplicateCandidate,
  AdminLibraryDuplicateConfidence,
  AdminLibraryDuplicateReason,
  AdminLibraryDuplicateTrack,
  AdminLibraryIntegrityIssue,
  AdminLibraryIntegrityIssueKind,
  AdminLibraryIntegrityStatus,
  AdminLibraryProblemKey,
  LibraryMetadataAlias,
  LibraryMetadataAliasKind,
  LibraryMetadataNormalizationCandidate,
  LibraryMetadataNormalizationVariant
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

export async function checkAdminLibraryIntegrity() {
  const response = await apiFetch('/api/admin/library/integrity/check', {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryOverviewResponse>;
}

export async function checkAdminLibraryDuplicates() {
  const response = await apiFetch('/api/admin/library/duplicates/check', {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryDuplicateReviewResponse>;
}

export async function setAdminLibraryDuplicateIgnored(
  trackIds: AdminLibraryDuplicateIgnoreRequest['trackIds'],
  ignored: boolean
) {
  const response = await apiFetch('/api/admin/library/duplicates/ignore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ trackIds, ignored } satisfies AdminLibraryDuplicateIgnoreRequest)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryDuplicateIgnoreResponse>;
}

export async function getAdminLibraryNormalization() {
  const response = await apiFetch('/api/admin/library/normalization', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryNormalizationReviewResponse>;
}

export async function associateAdminLibraryNormalization(input: AdminLibraryNormalizationAssociateRequest) {
  const response = await apiFetch('/api/admin/library/normalization/aliases', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryNormalizationReviewResponse>;
}

export async function removeAdminLibraryNormalizationAlias(id: string) {
  const response = await apiFetch(`/api/admin/library/normalization/aliases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
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
