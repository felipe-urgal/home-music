import type {
  AdminLibraryAssistantBatchDecisionRequest,
  AdminLibraryAssistantBatchDecisionResponse,
  AdminLibraryAssistantDecisionResponse,
  AdminLibraryAssistantPolicyResponse,
  AdminLibraryAssistantPolicyUpdateRequest,
  AdminLibraryAssistantResetResponse,
  AdminLibraryAssistantReviewResponse,
  AdminLibraryAssistantRunProgressResponse,
  AdminLibraryAssistantRunResponse,
  AdminLibraryAssistantRunsResponse,
  AdminLibraryAssistantSuggestionsResponse,
  LibraryAssistantCapability,
  LibraryAssistantDecision,
  LibraryAssistantReviewPolicy,
  LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import { apiFetch } from './api-client';

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Falha HTTP ${response.status}`;
}

export async function startLibraryAssistantRun(
  capability: LibraryAssistantCapability,
  options: { full?: boolean } = {}
) {
  const response = await apiFetch('/api/admin/library-assistant/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ capability, full: options.full === true })
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunResponse>;
}

export async function startLibraryAssistantMetadataRun(options: { full?: boolean } = {}) {
  const [metadata] = await Promise.all([
    startLibraryAssistantRun('metadata', options),
    startLibraryAssistantRun('lyrics', options)
  ]);
  return metadata;
}

export async function startLibraryAssistantLyricsRun(options: { full?: boolean } = {}) {
  return startLibraryAssistantRun('lyrics', options);
}

export async function getLibraryAssistantRuns(limit = 30) {
  const response = await apiFetch(`/api/admin/library-assistant/runs?limit=${limit}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunsResponse>;
}

export async function getLibraryAssistantRun(id: string) {
  const response = await apiFetch(`/api/admin/library-assistant/runs/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunResponse>;
}

export async function getLibraryAssistantRunProgress(id: string) {
  const response = await apiFetch(
    `/api/admin/library-assistant/runs/${encodeURIComponent(id)}/progress`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunProgressResponse>;
}

export async function getLibraryAssistantSuggestions(
  runId: string,
  status?: LibraryAssistantSuggestionStatus
) {
  const query = new URLSearchParams({ limit: '500' });
  if (status) query.set('status', status);
  const response = await apiFetch(
    `/api/admin/library-assistant/runs/${encodeURIComponent(runId)}/suggestions?${query}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantSuggestionsResponse>;
}

export async function getLibraryAssistantReview(limit = 500) {
  const response = await apiFetch(`/api/admin/library-assistant/review?limit=${limit}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantReviewResponse>;
}

export async function getLibraryAssistantReviewPolicy() {
  const response = await apiFetch('/api/admin/library-assistant/policy', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantPolicyResponse>;
}

export async function updateLibraryAssistantReviewPolicy(policy: LibraryAssistantReviewPolicy) {
  const payload: AdminLibraryAssistantPolicyUpdateRequest = { policy };
  const response = await apiFetch('/api/admin/library-assistant/policy', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantPolicyResponse>;
}

export async function resetLibraryAssistantReview() {
  const response = await apiFetch('/api/admin/library-assistant/review/reset', {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantResetResponse>;
}

export async function clearLibraryAssistantManagedLyrics(trackId: string) {
  const response = await apiFetch(
    `/api/admin/library-assistant/tracks/${encodeURIComponent(trackId)}/lyrics`,
    {
      method: 'DELETE',
      headers: { 'X-Home-Music-Request': '1' }
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<{ removed: boolean }>;
}

export async function decideLibraryAssistantSuggestion(decision: LibraryAssistantDecision) {
  const response = await apiFetch(
    `/api/admin/library-assistant/suggestions/${encodeURIComponent(decision.suggestionId)}/decision`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify(decision)
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantDecisionResponse>;
}

export async function decideLibraryAssistantBatch(
  decisions: LibraryAssistantDecision[],
  options: { confirmReview?: boolean } = {}
) {
  const payload: AdminLibraryAssistantBatchDecisionRequest = {
    decisions,
    confirmReview: options.confirmReview === true
  };
  const response = await apiFetch('/api/admin/library-assistant/decisions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantBatchDecisionResponse>;
}

async function cancelRunRequest(id: string) {
  const response = await apiFetch(`/api/admin/library-assistant/runs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunResponse>;
}

export async function cancelLibraryAssistantRun(id: string) {
  const listed = await getLibraryAssistantRuns();
  const active = listed.runs.filter(run => (
    (run.capability === 'metadata' || run.capability === 'lyrics')
    && !['completed', 'failed', 'cancelled', 'stale'].includes(run.status)
  ));
  const targets = active.some(run => run.id === id)
    ? active
    : [{ id }];
  const results = await Promise.all(targets.map(run => cancelRunRequest(run.id)));
  return results.find(result => result.run.id === id) ?? results[0];
}