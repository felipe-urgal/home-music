export type RepeatMode = 'off' | 'all' | 'one';

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
};

export type PlaylistsResponse = {
  playlists: Playlist[];
};
