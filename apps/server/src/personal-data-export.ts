import type {
  PersonalDataBundleV1,
  PortableTrackReferenceV1
} from '@home-music/shared/personal-data';
import { LibraryViewStore } from './library-views.js';
import type { PersonalLibraryService } from './personal-library-service.js';
import { SmartPlaylistStore } from './smart-playlists.js';

export const PERSONAL_DATA_FORMAT = 'home-music-personal-data' as const;
export const PERSONAL_DATA_VERSION = 1 as const;
export const PERSONAL_DATA_HISTORY_LIMIT = 500 as const;

type PersonalDataProjection = Pick<
  PersonalLibraryService,
  | 'getFavoriteIds'
  | 'getPlaylists'
  | 'getHistory'
  | 'loadPlaybackState'
  | 'portableTrackReferences'
>;

export class PersonalDataExportService {
  private readonly smartPlaylists: SmartPlaylistStore;
  private readonly libraryViews: LibraryViewStore;

  constructor(
    private readonly personal: PersonalDataProjection,
    databasePath: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.smartPlaylists = new SmartPlaylistStore(databasePath);
    this.libraryViews = new LibraryViewStore(databasePath);
  }

  close() {
    this.smartPlaylists.close();
    this.libraryViews.close();
  }

  exportForUser(userId: string): PersonalDataBundleV1 {
    const favoriteIds = this.personal.getFavoriteIds(userId);
    const manualPlaylists = this.personal.getPlaylists(userId)
      .filter(playlist => playlist.source === 'manual');
    const playbackHistory = this.personal.getHistory(userId, PERSONAL_DATA_HISTORY_LIMIT);
    const playbackState = this.personal.loadPlaybackState(userId);

    const referencedTrackIds = new Set<string>(favoriteIds);
    for (const playlist of manualPlaylists) {
      for (const trackId of playlist.trackIds) referencedTrackIds.add(trackId);
    }
    for (const item of playbackHistory) referencedTrackIds.add(item.track.id);
    if (playbackState.currentTrackId) referencedTrackIds.add(playbackState.currentTrackId);
    for (const trackId of playbackState.baseQueueIds) referencedTrackIds.add(trackId);
    for (const trackId of playbackState.queueIds) referencedTrackIds.add(trackId);

    const references = this.personal.portableTrackReferences([...referencedTrackIds]);
    const resolve = (trackIds: readonly string[]) => trackIds
      .map(trackId => references.get(trackId))
      .filter((reference): reference is PortableTrackReferenceV1 => Boolean(reference));

    const smartPlaylists = this.smartPlaylists.list(userId, new Set())
      .filter(playlist => playlist.rule)
      .map(playlist => ({
        name: playlist.name,
        rule: playlist.rule!,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt
      }));

    return {
      format: PERSONAL_DATA_FORMAT,
      version: PERSONAL_DATA_VERSION,
      exportedAt: this.now().toISOString(),
      favorites: resolve(favoriteIds),
      manualPlaylists: manualPlaylists.map(playlist => ({
        name: playlist.name,
        tracks: resolve(playlist.trackIds),
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt
      })),
      smartPlaylists,
      libraryViews: this.libraryViews.list(userId).map(view => ({
        name: view.name,
        definition: view.definition,
        createdAt: view.createdAt,
        updatedAt: view.updatedAt
      })),
      playbackHistory: playbackHistory.flatMap(item => {
        const track = references.get(item.track.id);
        return track ? [{ track, playedAt: item.playedAt }] : [];
      }),
      playbackState: {
        currentTrack: playbackState.currentTrackId
          ? references.get(playbackState.currentTrackId) ?? null
          : null,
        position: playbackState.position,
        volume: playbackState.volume,
        shuffle: playbackState.shuffle,
        repeatMode: playbackState.repeatMode,
        wasPlaying: playbackState.wasPlaying,
        baseQueue: resolve(playbackState.baseQueueIds),
        queue: resolve(playbackState.queueIds),
        updatedAt: playbackState.updatedAt
      }
    };
  }
}
