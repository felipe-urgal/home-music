import { apiFetch } from './api-client';

export type AdminJamendoImportBlockReason =
  | 'download-not-allowed'
  | 'license-missing'
  | 'license-unsupported';

export type AdminJamendoTrack = {
  sourceId: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  licenseUrl: string | null;
  downloadAllowed: boolean;
  previewAvailable: boolean;
  importAllowed: boolean;
  importBlockReason: AdminJamendoImportBlockReason | null;
  attribution: string;
};

export type AdminJamendoSearchResult = {
  items: AdminJamendoTrack[];
  pagination: {
    page: number;
    limit: number;
    total: number | null;
    nextPage: number | null;
  };
};

export async function searchAdminJamendo(query: string, page = 1, limit = 20) {
  const params = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });
  const response = await apiFetch(`/api/admin/imports/providers/jamendo/search?${params.toString()}`, {
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => null) as (AdminJamendoSearchResult & { error?: string }) | null;
  if (!response.ok || !payload || !Array.isArray(payload.items) || !payload.pagination) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload;
}

export async function checkAdminJamendoEligibility(sourceId: string) {
  const response = await apiFetch('/api/admin/imports/providers/jamendo/eligibility', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ sourceId })
  });
  const payload = await response.json().catch(() => null) as {
    allowed?: boolean;
    track?: AdminJamendoTrack;
    error?: string;
  } | null;
  if (!response.ok || payload?.allowed !== true || !payload.track) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.track;
}
