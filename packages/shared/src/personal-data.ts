import type {
  LibraryViewDefinition,
  RepeatMode,
  SmartPlaylistRule
} from './index.js';

export const PERSONAL_DATA_FORMAT = 'home-music-personal-data' as const;
export const PERSONAL_DATA_VERSION = 1 as const;
export const PERSONAL_DATA_HISTORY_LIMIT = 500 as const;

export const PERSONAL_DATA_IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxFavorites: 5_000,
  maxManualPlaylists: 250,
  maxTracksPerManualPlaylist: 5_000,
  maxSmartPlaylists: 250,
  maxLibraryViews: 250,
  maxPlaybackHistory: PERSONAL_DATA_HISTORY_LIMIT,
  maxQueueEntries: 5_000,
  maxTotalTrackReferences: 50_000,
  maxPreviewIssues: 250,
  maxRelativePathLength: 4_096,
  maxHintLength: 4_096,
  maxNameLength: 120,
  maxTimestampLength: 64
} as const;

export type PortableTrackReferenceV1 = {
  relativePath: string;
  hints: {
    title: string;
    artist: string;
    album: string;
    durationSeconds: number | null;
  };
};

export type PersonalDataManualPlaylistV1 = {
  name: string;
  tracks: PortableTrackReferenceV1[];
  createdAt: string;
  updatedAt: string;
};

export type PersonalDataSmartPlaylistV1 = {
  name: string;
  rule: SmartPlaylistRule;
  createdAt: string;
  updatedAt: string;
};

export type PersonalDataLibraryViewV1 = {
  name: string;
  definition: LibraryViewDefinition;
  createdAt: string;
  updatedAt: string;
};

export type PersonalDataPlaybackHistoryItemV1 = {
  track: PortableTrackReferenceV1;
  playedAt: string;
};

export type PersonalDataPlaybackStateV1 = {
  currentTrack: PortableTrackReferenceV1 | null;
  position: number;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  wasPlaying: boolean;
  baseQueue: PortableTrackReferenceV1[];
  queue: PortableTrackReferenceV1[];
  updatedAt: string;
};

export type PersonalDataBundleV1 = {
  format: typeof PERSONAL_DATA_FORMAT;
  version: typeof PERSONAL_DATA_VERSION;
  exportedAt: string;
  favorites: PortableTrackReferenceV1[];
  manualPlaylists: PersonalDataManualPlaylistV1[];
  smartPlaylists: PersonalDataSmartPlaylistV1[];
  libraryViews: PersonalDataLibraryViewV1[];
  playbackHistory: PersonalDataPlaybackHistoryItemV1[];
  playbackState: PersonalDataPlaybackStateV1;
};

export type PersonalDataImportPreviewReferenceStatus =
  | 'found'
  | 'missing'
  | 'ambiguous'
  | 'conflict';

export type PersonalDataImportPreviewReferenceCounts = {
  total: number;
  found: number;
  missing: number;
  ambiguous: number;
  conflict: number;
};

export type PersonalDataImportPreviewDomain =
  | 'favorites'
  | 'manual-playlists'
  | 'playback-history'
  | 'playback-state';

export type PersonalDataImportPreviewIssueReason =
  | 'relative-path-conflict'
  | 'relative-path-ambiguous'
  | 'hints-ambiguous'
  | 'insufficient-hints'
  | 'no-candidate';

export type PersonalDataImportPreviewIssueV1 = {
  domain: PersonalDataImportPreviewDomain;
  field: string;
  relativePath: string;
  status: Exclude<PersonalDataImportPreviewReferenceStatus, 'found'>;
  reason: PersonalDataImportPreviewIssueReason;
};

export type PersonalDataImportPreviewV1 = {
  format: typeof PERSONAL_DATA_FORMAT;
  version: typeof PERSONAL_DATA_VERSION;
  exportedAt: string;
  references: PersonalDataImportPreviewReferenceCounts;
  domains: {
    favorites: {
      items: number;
      references: PersonalDataImportPreviewReferenceCounts;
    };
    manualPlaylists: {
      items: number;
      references: PersonalDataImportPreviewReferenceCounts;
    };
    smartPlaylists: {
      items: number;
    };
    libraryViews: {
      items: number;
    };
    playbackHistory: {
      items: number;
      references: PersonalDataImportPreviewReferenceCounts;
    };
    playbackState: {
      references: PersonalDataImportPreviewReferenceCounts;
    };
  };
  issues: PersonalDataImportPreviewIssueV1[];
  issuesTruncated: boolean;
};

export type PersonalDataImportPreviewResponseV1 = PersonalDataImportPreviewV1 & {
  confirmationToken: string;
};

export type PersonalDataImportApplyDomainSummaryV1 = {
  applied: number;
  ignored: number;
};

export type PersonalDataImportApplySummaryV1 = {
  applied: number;
  ignored: number;
  missing: number;
  ambiguous: number;
  conflict: number;
  failed: number;
  domains: {
    favorites: PersonalDataImportApplyDomainSummaryV1;
    manualPlaylists: PersonalDataImportApplyDomainSummaryV1;
    smartPlaylists: PersonalDataImportApplyDomainSummaryV1;
    libraryViews: PersonalDataImportApplyDomainSummaryV1;
    playbackHistory: PersonalDataImportApplyDomainSummaryV1;
    playbackState: PersonalDataImportApplyDomainSummaryV1;
  };
};

export type PersonalDataImportApplyResponseV1 = {
  preview: PersonalDataImportPreviewV1;
  summary: PersonalDataImportApplySummaryV1;
};
