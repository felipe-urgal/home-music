export type RepeatMode = 'off' | 'all' | 'one';
export type NormalizationMode = 'off' | 'track' | 'album';
export type StatisticsPeriod = '7d' | '30d' | 'all';
export type PlaylistSource = 'manual' | 'rekordbox';
export type UserRole = 'admin' | 'user';
export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type ImportJobSourceType = 'upload' | 'url' | 'provider';

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

export type AdminLibraryOverviewResponse = {
  tracks: {
    total: number;
  };
  storage: {
    libraryBytes: number;
  };
  problems: {
    affectedTracks: number;
    missingCover: number;
    unknownArtist: number;
    unknownAlbum: number;
    missingDuration: number;
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
};

export type AdminImportJobsResponse = {
  jobs: ImportJob[];
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