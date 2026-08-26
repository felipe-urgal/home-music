export type RepeatMode = 'off' | 'all' | 'one';
export type NormalizationMode = 'off' | 'track' | 'album';
export type StatisticsPeriod = '7d' | '30d' | 'all';
export type PlaylistSource = 'manual' | 'rekordbox';
export type UserRole = 'admin' | 'user';

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: UserRole;
};

export type AuthStatusResponse = {
  configured: boolean;
  authenticated: boolean;
  user: AuthenticatedUser | null;
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
  replayGainTrackDb?: number | null;
  replayGainAlbumDb?: number | null;
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
