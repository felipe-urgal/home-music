export const LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM = 'sha256' as const;
export const LIBRARY_ASSISTANT_CONTENT_HASH_VERSION = 1 as const;

export type LibraryAssistantContentIdentity = {
  algorithm: typeof LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM;
  version: typeof LIBRARY_ASSISTANT_CONTENT_HASH_VERSION;
  digest: string;
  sizeBytes: number;
};

export type LibraryAssistantJobKind = 'content-hash';
export type LibraryAssistantJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export type LibraryAssistantJobError = {
  code: string;
  message: string;
  action: string;
};

export type LibraryAssistantJobProgress = {
  completed: number;
  total: number;
};

export type LibraryAssistantJob = {
  id: string;
  kind: LibraryAssistantJobKind;
  status: LibraryAssistantJobStatus;
  libraryRevision: number;
  progress: LibraryAssistantJobProgress;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: LibraryAssistantJobError | null;
};

export type AdminLibraryAssistantJobsResponse = {
  jobs: LibraryAssistantJob[];
};

export type AdminLibraryAssistantJobResponse = {
  job: LibraryAssistantJob;
};

export type AdminLibraryAssistantStartJobRequest = {
  kind: LibraryAssistantJobKind;
};
