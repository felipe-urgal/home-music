import type {
  AdminTrackCoverCandidate,
  AdminTrackCoverCandidatesResponse,
  AdminTrackCoverResponse,
  AdminTrackMetadataSuggestionResponse,
  EditableTrackMetadata
} from '@home-music/shared';
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
  AdminLibraryAssistantRunTracksResponse,
  AdminLibraryAssistantSuggestionsResponse,
  LibraryAssistantCapability,
  LibraryAssistantDecision,
  LibraryAssistantMetadataField,
  LibraryAssistantReviewPolicy,
  LibraryAssistantSuggestionStatus,
  LocalLyricsCapabilityResponse,
  LocalLyricsEligibleTracksResponse,
  LocalLyricsJobResponse,
  LocalLyricsStartJobRequest,
  AdminMissingCoverFillResponse
} from '@home-music/shared/library-assistant';
import { apiFetch } from './api-client';

export type LibraryAssistantFingerprintStatus = {
  fpcalc: {
    available: boolean;
    version: string | null;
    issue: 'invalid-command' | 'not-found' | 'timeout' | 'failed' | 'invalid-output' | null;
  };
  acoustIdEnabled: boolean;
  acoustIdConfigured: boolean;
};

export type LibraryAssistantFingerprintResult = {
  fingerprintGenerated: boolean;
  cacheHit: boolean;
  externalLookup: boolean;
  identified: boolean;
  acoustIdEnabled: boolean;
  runId: string | null;
  suggestionIds: string[];
  recordingId: string | null;
  conflict: boolean;
  ambiguous: boolean;
};

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error || `Falha HTTP ${response.status}`;
}

export async function searchTrackMetadataSuggestion(
  trackId: string,
  metadata: EditableTrackMetadata
) {
  const response = await apiFetch(
    `/api/admin/library-assistant/tracks/${encodeURIComponent(trackId)}/metadata-suggestion`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify(metadata)
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackMetadataSuggestionResponse>;
}

export async function searchTrackArtworkCandidates(
  trackId: string,
  metadata: EditableTrackMetadata
) {
  const response = await apiFetch(
    `/api/admin/library-assistant/tracks/${encodeURIComponent(trackId)}/artwork-candidates`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify(metadata)
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackCoverCandidatesResponse>;
}

export function trackArtworkCandidatePreviewUrl(candidate: AdminTrackCoverCandidate) {
  const query = new URLSearchParams({ sourceUrl: candidate.sourceUrl });
  if (candidate.thumbnailUrl) query.set('thumbnailUrl', candidate.thumbnailUrl);
  return `/api/admin/library-assistant/artwork-candidates/preview?${query}`;
}

export async function applyTrackArtworkCandidate(
  trackId: string,
  candidate: AdminTrackCoverCandidate
) {
  const response = await apiFetch(
    `/api/admin/library-assistant/tracks/${encodeURIComponent(trackId)}/artwork-candidates/apply`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify({
        sourceUrl: candidate.sourceUrl,
        thumbnailUrl: candidate.thumbnailUrl
      })
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminTrackCoverResponse>;
}

export async function startLibraryAssistantRun(
  capability: LibraryAssistantCapability,
  options: { full?: boolean; fields?: LibraryAssistantMetadataField[] } = {}
) {
  const response = await apiFetch('/api/admin/library-assistant/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({
      capability,
      full: options.full === true,
      ...(options.fields?.length ? { fields: options.fields } : {})
    })
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunResponse>;
}

export type LibraryAssistantAnalysisTarget =
  | LibraryAssistantMetadataField
  | 'artwork'
  | 'lyrics'
  | 'all';

export async function startLibraryAssistantAnalysis(
  target: LibraryAssistantAnalysisTarget,
  options: { full?: boolean } = {}
) {
  if (target === 'all') {
    const [metadata, artwork, lyrics] = await Promise.all([
      startLibraryAssistantRun('metadata', options),
      startLibraryAssistantRun('artwork', options),
      startLibraryAssistantRun('lyrics', options)
    ]);
    return {
      run: metadata.run,
      runs: [metadata.run, artwork.run, lyrics.run]
    };
  }

  if (target === 'artwork' || target === 'lyrics') {
    const result = await startLibraryAssistantRun(target, options);
    return { run: result.run, runs: [result.run] };
  }

  const result = await startLibraryAssistantRun('metadata', {
    ...options,
    fields: [target]
  });
  return { run: result.run, runs: [result.run] };
}

export async function startLibraryAssistantMetadataRun(options: { full?: boolean } = {}) {
  return startLibraryAssistantAnalysis('all', options);
}

export async function startLibraryAssistantLyricsRun(options: { full?: boolean } = {}) {
  return startLibraryAssistantRun('lyrics', options);
}

export async function getMissingCoverFillJob() {
  const response = await apiFetch('/api/admin/library-assistant/covers/fill', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminMissingCoverFillResponse>;
}

export async function startMissingCoverFillJob() {
  const response = await apiFetch('/api/admin/library-assistant/covers/fill', {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminMissingCoverFillResponse>;
}


export type LibraryAssistantAutonomyState = {
  config: {
    enabled: boolean;
    metadata: boolean;
    fillMissingOnly: true;
  };
  activeRunId: string | null;
  pendingRevision: number | null;
  lastSummary: {
    runId: string;
    applied: number;
    review: number;
    stale: number;
    failed: number;
    finishedAt: string;
  } | null;
};

export async function getLibraryAssistantAutonomy() {
  const response = await apiFetch('/api/admin/library-assistant/autonomy', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LibraryAssistantAutonomyState>;
}

export async function updateLibraryAssistantAutonomy(enabled: boolean) {
  const response = await apiFetch('/api/admin/library-assistant/autonomy', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ enabled, metadata: true })
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LibraryAssistantAutonomyState>;
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

export async function getLibraryAssistantRunTracks(id: string) {
  const response = await apiFetch(
    `/api/admin/library-assistant/runs/${encodeURIComponent(id)}/tracks?limit=5000`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantRunTracksResponse>;
}

export async function getLibraryAssistantSuggestions(
  runId: string,
  status?: LibraryAssistantSuggestionStatus
) {
  const query = new URLSearchParams({ limit: '5000' });
  if (status) query.set('status', status);
  const response = await apiFetch(
    `/api/admin/library-assistant/runs/${encodeURIComponent(runId)}/suggestions?${query}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantSuggestionsResponse>;
}

export async function getLibraryAssistantReview(limit = 5000) {
  const response = await apiFetch(`/api/admin/library-assistant/review?limit=${limit}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantReviewResponse>;
}

export async function getLibraryAssistantReviewPolicy() {
  const response = await apiFetch('/api/admin/library-assistant/policy', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<AdminLibraryAssistantPolicyResponse>;
}

export async function getLibraryAssistantFingerprintStatus() {
  const response = await apiFetch('/api/admin/library-assistant/fingerprint', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LibraryAssistantFingerprintStatus>;
}

export async function getLocalLyricsCapability() {
  const response = await apiFetch('/api/admin/library-assistant/local-lyrics/capability', { cache: 'no-store' });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LocalLyricsCapabilityResponse>;
}

export async function getLocalLyricsEligibleTracks(query = '', limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set('query', query.trim());
  const response = await apiFetch(
    `/api/admin/library-assistant/local-lyrics/tracks?${params}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LocalLyricsEligibleTracksResponse>;
}

export async function startLocalLyricsJob(payload: LocalLyricsStartJobRequest) {
  const response = await apiFetch('/api/admin/library-assistant/local-lyrics/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LocalLyricsJobResponse>;
}

export async function getLocalLyricsJob(id: string) {
  const response = await apiFetch(
    `/api/admin/library-assistant/local-lyrics/jobs/${encodeURIComponent(id)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LocalLyricsJobResponse>;
}

export async function cancelLocalLyricsJob(id: string) {
  const response = await apiFetch(
    `/api/admin/library-assistant/local-lyrics/jobs/${encodeURIComponent(id)}/cancel`,
    {
      method: 'POST',
      headers: { 'X-Home-Music-Request': '1' }
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LocalLyricsJobResponse>;
}

export async function fingerprintLibraryAssistantSuggestion(runId: string, suggestionId: string) {
  const response = await apiFetch(
    `/api/admin/library-assistant/runs/${encodeURIComponent(runId)}/suggestions/${encodeURIComponent(suggestionId)}/fingerprint`,
    {
      method: 'POST',
      headers: { 'X-Home-Music-Request': '1' }
    }
  );
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<LibraryAssistantFingerprintResult>;
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

export async function cancelSingleLibraryAssistantRun(id: string) {
  return cancelRunRequest(id);
}

export async function cancelLibraryAssistantRun(id: string) {
  const listed = await getLibraryAssistantRuns();
  const active = listed.runs.filter(run => (
    (run.capability === 'metadata' || run.capability === 'artwork' || run.capability === 'lyrics')
    && !['completed', 'failed', 'cancelled', 'stale'].includes(run.status)
  ));
  const targets = active.some(run => run.id === id)
    ? active
    : [{ id }];
  const results = await Promise.all(targets.map(run => cancelRunRequest(run.id)));
  return results.find(result => result.run.id === id) ?? results[0];
}
