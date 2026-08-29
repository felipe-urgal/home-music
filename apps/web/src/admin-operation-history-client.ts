import type {
  AdminOperationHistoryItem,
  AdminOperationKind,
  AdminOperationStatus,
  ImportJob
} from '@home-music/shared';
import { apiFetch } from './api-client';

type HistoryFilters = {
  kind?: AdminOperationKind;
  status?: AdminOperationStatus;
};

export type AdminImportFailureDisposition = 'none' | 'retryable' | 'definitive';

export type AdminImportRetryInfo = {
  attempt: number;
  parentOperationId: string | null;
  rootOperationId: string;
  failureDisposition: AdminImportFailureDisposition;
};

export type AdminOperationHistoryItemWithRetry = AdminOperationHistoryItem & {
  importRetry: AdminImportRetryInfo | null;
};

export type AdminOperationHistoryWithRetryResponse = {
  items: AdminOperationHistoryItemWithRetry[];
};

export type AdminOperationRetryInput =
  | { fileName: string; size: number }
  | { url: string };

async function apiJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url, {
    cache: 'no-store',
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
  return apiJson<AdminOperationHistoryWithRetryResponse>(`/api/admin/operations?${search.toString()}`);
}

export async function retryAdminOperation(operationId: string, input: AdminOperationRetryInput) {
  const response = await apiFetch(`/api/admin/operations/${encodeURIComponent(operationId)}/retry`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(input)
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}.`);
  }
  return payload.job;
}
