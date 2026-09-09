export const LIBRARY_ASSISTANT_CONTRACT_VERSION = 1 as const;
export const LIBRARY_ASSISTANT_ALGORITHM_VERSION = 1 as const;

export type LibraryAssistantCapability = 'metadata' | 'artwork' | 'lyrics';
export type LibraryAssistantRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';
export type LibraryAssistantSuggestionStatus =
  | 'pending'
  | 'review'
  | 'applied'
  | 'rejected'
  | 'stale'
  | 'failed';
export type LibraryAssistantConfidenceBand = 'low' | 'medium' | 'high';
export type LibraryAssistantProvenanceSource =
  | 'local'
  | 'musicbrainz'
  | 'cover-art-archive'
  | 'lrclib'
  | 'acoustid'
  | 'generated'
  | 'local-transcription';

export type LibraryAssistantMetadataField = 'title' | 'artist' | 'album' | 'albumArtist';
export type LibraryAssistantExternalIdKind = 'recording' | 'release' | 'release-group' | 'artist';

export type LibraryAssistantReasonCode =
  | 'local-review'
  | 'metadata-missing'
  | 'artwork-missing'
  | 'metadata-conflict'
  | 'exact-text-match'
  | 'normalized-text-match'
  | 'duration-close'
  | 'duration-mismatch'
  | 'strong-external-id'
  | 'album-context'
  | 'source-conflict'
  | 'provider-match'
  | 'human-override'
  | 'ambiguous-candidates';

export type LibraryAssistantProvenance = {
  source: LibraryAssistantProvenanceSource;
  providerVersion: string | null;
  externalId: string | null;
};

export type LibraryAssistantTextMatchEvidence = {
  type: 'text-match';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  field: LibraryAssistantMetadataField;
  match: 'exact' | 'normalized' | 'different';
  sourceValue: string;
  candidateValue: string;
};

export type LibraryAssistantDurationDeltaEvidence = {
  type: 'duration-delta';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  deltaSeconds: number;
};

export type LibraryAssistantExternalIdEvidence = {
  type: 'external-id';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  source: LibraryAssistantProvenanceSource;
  id: string;
  kind?: LibraryAssistantExternalIdKind;
};

export type LibraryAssistantAlbumContextEvidence = {
  type: 'album-context';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  matchedTracks: number;
  totalTracks: number;
};

export type LibraryAssistantSourceConflictEvidence = {
  type: 'source-conflict';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  field: LibraryAssistantMetadataField | 'artwork' | 'lyrics';
  sources: LibraryAssistantProvenanceSource[];
};

export type LibraryAssistantFileContextEvidence = {
  type: 'file-context';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  fileName: string;
  folderName: string | null;
};

export type LibraryAssistantHumanOverrideEvidence = {
  type: 'human-override';
  version: typeof LIBRARY_ASSISTANT_CONTRACT_VERSION;
  field: LibraryAssistantMetadataField;
};

export type LibraryAssistantEvidence =
  | LibraryAssistantTextMatchEvidence
  | LibraryAssistantDurationDeltaEvidence
  | LibraryAssistantExternalIdEvidence
  | LibraryAssistantAlbumContextEvidence
  | LibraryAssistantSourceConflictEvidence
  | LibraryAssistantFileContextEvidence
  | LibraryAssistantHumanOverrideEvidence;

export type LibraryAssistantMetadataTarget = {
  capability: 'metadata';
  trackId: string;
  field: LibraryAssistantMetadataField;
  currentValue: string;
  suggestedValue: string;
};

export type LibraryAssistantArtworkTarget = {
  capability: 'artwork';
  trackId: string;
  candidateId: string;
  label: string | null;
  sourceUrl: string;
  thumbnailUrl: string | null;
  currentHasCover: boolean;
  currentCoverVersion: string | null;
  musicBrainzReleaseId: string;
  musicBrainzReleaseGroupId: string | null;
};

export type LibraryAssistantLyricsTarget = {
  capability: 'lyrics';
  trackId: string;
  candidateId: string;
  synchronized: boolean;
  language: string | null;
};

export type LibraryAssistantSuggestionTarget =
  | LibraryAssistantMetadataTarget
  | LibraryAssistantArtworkTarget
  | LibraryAssistantLyricsTarget;

export type LibraryAssistantSuggestion = {
  id: string;
  runId: string;
  capability: LibraryAssistantCapability;
  status: LibraryAssistantSuggestionStatus;
  confidence: LibraryAssistantConfidenceBand;
  reasonCodes: LibraryAssistantReasonCode[];
  evidence: LibraryAssistantEvidence[];
  provenance: LibraryAssistantProvenance;
  target: LibraryAssistantSuggestionTarget;
  createdAt: string;
  updatedAt: string;
};

const LIBRARY_ASSISTANT_AUTO_APPLY_BLOCKERS = new Set<LibraryAssistantReasonCode>([
  'human-override',
  'ambiguous-candidates',
  'source-conflict',
  'metadata-conflict'
]);

export function isLibraryAssistantAutoApplicable(
  suggestion: Pick<LibraryAssistantSuggestion, 'status' | 'confidence' | 'reasonCodes'>
) {
  return (suggestion.status === 'pending' || suggestion.status === 'review')
    && suggestion.confidence === 'high'
    && !suggestion.reasonCodes.some(reason => LIBRARY_ASSISTANT_AUTO_APPLY_BLOCKERS.has(reason));
}

export type LibraryAssistantRunError = {
  code: string;
  message: string;
  action: string;
};

export type LibraryAssistantRunSummary = {
  total: number;
  pending: number;
  review: number;
  applied: number;
  rejected: number;
  stale: number;
  failed: number;
};

export type LibraryAssistantRun = {
  id: string;
  capability: LibraryAssistantCapability;
  status: LibraryAssistantRunStatus;
  libraryRevision: number;
  algorithmVersion: typeof LIBRARY_ASSISTANT_ALGORITHM_VERSION;
  summary: LibraryAssistantRunSummary;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: LibraryAssistantRunError | null;
};

export type LibraryAssistantRunProgressMetrics = {
  elapsedMs: number;
  tracksPerSecond: number;
  etaMs: number | null;
  searchAttempts: number;
  externalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimitWaitMs: number;
  retriesTotal: number;
  retriesByReason: Record<string, number>;
};

export type LibraryAssistantRunProgress = {
  total: number;
  processed: number;
  pending: number;
  processing: number;
  matched: number;
  noMatch: number;
  retry: number;
  failed: number;
  metrics?: LibraryAssistantRunProgressMetrics;
};

export type AdminLibraryAssistantStartRunRequest = {
  capability: LibraryAssistantCapability;
  full?: boolean;
};

export type AdminLibraryAssistantRunResponse = {
  run: LibraryAssistantRun;
};

export type AdminLibraryAssistantRunsResponse = {
  runs: LibraryAssistantRun[];
};

export type AdminLibraryAssistantRunProgressResponse = {
  progress: LibraryAssistantRunProgress;
};

export type AdminLibraryAssistantSuggestionsResponse = {
  suggestions: LibraryAssistantSuggestion[];
};

export type LibraryAssistantReviewTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  physical: {
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
  };
};

export type LibraryAssistantReviewItem = {
  runLibraryRevision: number;
  suggestion: LibraryAssistantSuggestion;
  track: LibraryAssistantReviewTrack;
};

export type AdminLibraryAssistantReviewResponse = {
  libraryRevision: number;
  items: LibraryAssistantReviewItem[];
};

export type AdminLibraryAssistantResetResponse = {
  invalidated: number;
};

export type LibraryAssistantDecisionAction = 'apply' | 'reject';
export type LibraryAssistantDecisionOutcome =
  | 'applied'
  | 'rejected'
  | 'already-applied'
  | 'already-rejected'
  | 'stale'
  | 'not-found'
  | 'unsupported'
  | 'failed';

export type LibraryAssistantDecision = {
  runId: string;
  suggestionId: string;
  action: LibraryAssistantDecisionAction;
  expectedLibraryRevision: number;
  expectedCurrentValue: string;
  replaceExistingArtworkOverride?: boolean;
};

export type LibraryAssistantDecisionResult = {
  runId: string;
  suggestionId: string;
  action: LibraryAssistantDecisionAction;
  outcome: LibraryAssistantDecisionOutcome;
  currentValue: string | null;
  message: string | null;
};

export type LibraryAssistantDecisionSummary = {
  total: number;
  applied: number;
  rejected: number;
  alreadyResolved: number;
  stale: number;
  failed: number;
};

export type AdminLibraryAssistantDecisionRequest = LibraryAssistantDecision;

export type AdminLibraryAssistantDecisionResponse = {
  result: LibraryAssistantDecisionResult;
};

export type AdminLibraryAssistantBatchDecisionRequest = {
  decisions: LibraryAssistantDecision[];
  confirmReview?: boolean;
};

export type AdminLibraryAssistantBatchDecisionResponse = {
  results: LibraryAssistantDecisionResult[];
  summary: LibraryAssistantDecisionSummary;
};
