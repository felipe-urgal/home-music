import type { AdminLibraryOverviewResponse } from '@home-music/shared';
import { apiFetch } from './api-client';

export async function getAdminLibraryOverview() {
  const response = await apiFetch('/api/admin/library/overview', { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return response.json() as Promise<AdminLibraryOverviewResponse>;
}
