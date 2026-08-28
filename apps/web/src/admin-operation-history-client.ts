import type {
  AdminOperationHistoryResponse,
  AdminOperationKind,
  AdminOperationStatus
} from '@home-music/shared';

type HistoryFilters = {
  kind?: AdminOperationKind;
  status?: AdminOperationStatus;
};

async function apiJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error || `Falha HTTP ${response.status}.`);
  return body as T;
}

export function getAdminOperationHistory(filters: HistoryFilters = {}) {
  const search = new URLSearchParams();
  if (filters.kind) search.set('kind', filters.kind);
  if (filters.status) search.set('status', filters.status);
  search.set('limit', '200');
  return apiJson<AdminOperationHistoryResponse>(`/api/admin/operations?${search.toString()}`);
}
