import type {
  LibraryViewDefinition,
  RepeatMode,
  SmartPlaylistRule
} from './index.js';

export const PERSONAL_DATA_FORMAT = 'home-music-personal-data' as const;
export const PERSONAL_DATA_VERSION = 1 as const;
export const PERSONAL_DATA_HISTORY_LIMIT = 500 as const;

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
