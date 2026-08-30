export type RepeatMode = 'off' | 'all' | 'one';
export type NormalizationMode = 'off' | 'track' | 'album';
export type StatisticsPeriod = '7d' | '30d' | 'all';
export type PlaylistSource = 'manual' | 'rekordbox';
export type UserRole = 'admin' | 'user';
export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type ImportJobSourceType = 'upload' | 'url' | 'provider';
export type ImportOutputProfile = 'original' | 'economy' | 'compatibility';
export type ImportMediaAction = 'preserve' | 'remux' | 'transcode';
export type ImportMediaDecisionReason =
  | 'original-compatible'
  | 'already-economical'
  | 'already-compatible'
  | 'economy-requested'
  | 'compatibility-requested'
  | 'unsupported-original'
  | 'contains-video'
  | 'multiple-audio-streams';
export type ImportMetadataFieldName = 'title' | 'artist' | 'album' | 'albumArtist';
export type ImportMetadataFieldState = 'trusted' | 'suggested' | 'fallback' | 'missing' | 'conflict' | 'edited';
export type AdminOperationKind = 'scan' | 'import';
export type AdminOperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AdminScanTrigger = 'manual' | 'automatic';

export const PERMANENT_DELETE_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE' as const;

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type AuthStatusResponse = {
  configured: boolean;
  authenticated: boolean;
  user: AuthenticatedUser | null;
  passwordChangeRequired: boolean;
};

export type AdminUser = {
  id: string;
  username: string;
  role: UserRole;
  enabled: boolean;
  passwordMustChange: boolean;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string | null;
};

export type AdminUsersResponse = {
  users: AdminUser[];
};

export type AdminUserCreateResponse = {
  user: AdminUser;
  temporaryPassword: string;
};

export type AdminUserPasswordResetResponse = AdminUserCreateResponse;

export type AdminUserSessionsRevokeResponse = {
  revokedSessions: number;
};

export type AdminLibraryProblemKey =
  | 'missingTitle'
  | 'missingCover'
  | 'unknownArtist'
  | 'unknownAlbum'
  | 'missingDuration';

export type AdminLibraryOverviewResponse = {
  tracks: {
    total: number;
  };
  storage: {
    libraryBytes: number;
    databaseBytes: number | null;
  };
  problems: {
    affectedTracks: number;
    missingTitle: number;
    missingCover: number;
    unknownArtist: number;
    unknownAlbum: number;
    missingDuration: number;
    trackIds: Record<AdminLibraryProblemKey, string[]>;
  };
  scanner: {
    ready: boolean;
    scanning: boolean;
    scannedAt: string;
    autoRescan: {
      enabled: boolean;
      intervalSeconds: number | null;
    };
  };
};

export type ImportJobSource = {
  type: ImportJobSourceType;
  provider: string | null;
};

export type ImportMediaTechnicalInfo = {
  container: string;
  codec: string;
  durationSeconds: number;
  bitRate: number | null;
  sampleRate: number | null;
  channels: number | null;
  audioStreams: number;
  videoStreams: number;
};

export type ImportMediaOutputInfo = {
  container: string;
  codec: string;
  extension: string;
  bitRate: number | null;
};

export type ImportMediaDecision = {
  profile: ImportOutputProfile;
  action: ImportMediaAction;
  reason: ImportMediaDecisionReason;
  selectedAudioStream: number;
  input: ImportMediaTechnicalInfo;
  output: ImportMediaOutputInfo;
};

export type ImportMetadataValues = {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
};

export type ImportMetadataFieldStates = Record<ImportMetadataFieldName, ImportMetadataFieldState>;

export type ImportMetadataCoverPreview = {
  available: boolean;
  contentType: string | null;
  sizeBytes: number | null;
};

export type ImportMetadataPreview = {
  embedded: ImportMetadataValues;
  provider: ImportMetadataValues | null;
  overrides: ImportMetadataValues;
  effective: ImportMetadataValues;
  fieldStates: ImportMetadataFieldStates;
  durationSeconds: number;
  cover: ImportMetadataCoverPreview;
  generatedAt: string;
};

export type ImportMetadataPreviewPatch = Partial<ImportMetadataValues>;

export type ImportJob = {
  id: string;
  source: ImportJobSource;
  label: string;
  status: ImportJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  mediaDecision: ImportMediaDecision | null;
  metadataPreview: ImportMetadataPreview | null;
};

export type AdminImportJobsResponse = {
  jobs: ImportJob[];
};

export type AdminOperationCounts = {
  tracks: number | null;
  added: number | null;
  updated: number | null;
  removed: number | null;
  unchanged: number | null;
};

export type AdminOperationError = {
  message: string;
  action: string;
};

export type AdminOperationHistoryItem = {
  id: string;
  kind: AdminOperationKind;
  status: AdminOperationStatus;
  label: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  scanTrigger: AdminScanTrigger | null;
  importSource: ImportJobSource | null;
  counts: AdminOperationCounts;
  error: AdminOperationError | null;
  canRetry: boolean;
};

export type AdminOperationHistoryResponse = {
  items: AdminOperationHistoryItem[];
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  folder: string;
  folderPath: string;
  duration: number | null;
  format: string;
  hasCover: boolean;
  coverVersion?: string;
  replayGainTrackDb?: number | null;
  replayGainAlbumDb?: number | null;
};

export type EditableTrackMetadata = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
};

export type TrackMetadataOverride = {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  updatedAt: string | null;
};

export type TrackMetadataOverridePatch = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
};

export type AdminTrackMetadataResponse = {
  trackId: string;
  physical: EditableTrackMetadata;
  override: TrackMetadataOverride;
  effective: EditableTrackMetadata;
};

export type TrackCoverOverride = {
  contentType: string;
  width: number;
  height: number;
  sizeBytes: number;
  updatedAt: string;
  version: string;
};

export type AdminTrackCoverResponse = {
  trackId: string;
  physicalHasCover: boolean;
  effectiveHasCover: boolean;
  override: TrackCoverOverride | null;
};

export type AdminTrack = Track & {
  enabled: boolean;
};

export type AdminTracksResponse = {
  tracks: AdminTrack[];
  active: number;
  inactive: number;
};

export type AdminTrackFileLocation = {
  trackId: string;
  relativePath: string;
  folderPath: string;
  fileName: string;
};

export type AdminTrackMoveRequest = {
  folderPath: string;
  fileName: string;
};

export type AdminTrackMoveResponse = {
  track: AdminTrack;
  location: AdminTrackFileLocation;
  moved: boolean;
};

export type AdminQuarantinedTrack = Track & {
  quarantinedAt: string;
  originalPath: string;
  lastError: string | null;
};

export type AdminQuarantineResponse = {
  tracks: AdminQuarantinedTrack[];
};

export type LibraryResponse = {
  tracks: Track[];
  scannedAt: string;
  scanning: boolean;
};

export type ScanResponse = {
  tracks: number;
  scannedAt: string;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
};

export type PlaybackState = {
  currentTrackId: string | null;
  position: number;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  wasPlaying: boolean;
  baseQueueIds: string[];
  queueIds: string[];
  updatedAt: string;
};

export type FavoritesResponse = {
  trackIds: string[];
};

export type HistoryItem = {
  id: number;
  track: Track;
  playedAt: string;
};

export type HistoryResponse = {
  items: HistoryItem[];
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
  source: PlaylistSource;
};

export type PlaylistsResponse = {
  playlists: Playlist[];
};

export type RekordboxPlaylistPreview = {
  name: string;
  totalEntries: number;
  matchedEntries: number;
};

export type RekordboxUnmatchedTrack = {
  title: string;
  artist: string;
};

export type RekordboxPreviewResponse = {
  productName: string | null;
  productVersion: string | null;
  collectionTracks: number;
  matchedCollectionTracks: number;
  unmatchedCollectionTracks: number;
  playlists: number;
  playlistEntries: number;
  matchedPlaylistEntries: number;
  unmatchedSample: RekordboxUnmatchedTrack[];
  playlistPreview: RekordboxPlaylistPreview[];
};

export type RekordboxImportResponse = RekordboxPreviewResponse & {
  createdPlaylists: number;
  updatedPlaylists: number;
  removedPlaylists: number;
};

export type LyricsLine = {
  time: number | null;
  text: string;
};

export type LyricsResponse = {
  source: 'lrc' | 'txt';
  synchronized: boolean;
  lines: LyricsLine[];
};

export type TrackStatisticsItem = {
  track: Track;
  plays: number;
};

export type ArtistStatisticsItem = {
  artist: string;
  plays: number;
};

export type AlbumStatisticsItem = {
  album: string;
  albumArtist: string;
  plays: number;
};

export type ListeningStatisticsResponse = {
  period: StatisticsPeriod;
  generatedAt: string;
  firstPlayedAt: string | null;
  totalPlays: number;
  totalMinutes: number;
  uniqueTracks: number;
  uniqueArtists: number;
  topTracks: TrackStatisticsItem[];
  topArtists: ArtistStatisticsItem[];
  topAlbums: AlbumStatisticsItem[];
  historyCapacity: number;
};