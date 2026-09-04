import type { PlaybackState, RepeatMode } from '@home-music/shared';
import type { HomeMusicDatabase } from './database.js';
import type { LibraryService } from './library-service.js';

type PlaylistMutationStatus = 'ok' | 'not-found' | 'read-only' | 'invalid-name';
type PlaylistTracksStatus = 'ok' | 'not-found' | 'read-only' | 'invalid-tracks';

type FavoriteMutationResult =
  | { status: 'ok'; favorite: boolean }
  | { status: 'not-found' }
  | { status: 'invalid-favorite' };

export class PersonalLibraryService {
  constructor(
    private readonly database: HomeMusicDatabase,
    private readonly library: LibraryService
  ) {}

  getFavoriteIds(userId: string) {
    return this.database.getFavoriteIds(userId);
  }

  setFavorite(userId: string, trackId: string, favorite: unknown): FavoriteMutationResult {
    if (!this.library.getTrack(trackId)) return { status: 'not-found' };
    if (typeof favorite !== 'boolean') return { status: 'invalid-favorite' };
    this.database.setFavorite(userId, trackId, favorite);
    return { status: 'ok', favorite };
  }

  getPlaylists(userId: string) {
    return this.database.getPlaylists(userId);
  }

  createPlaylist(userId: string, rawName: unknown) {
    const name = cleanName(rawName);
    if (!name) return { status: 'invalid-name' as const };

    const id = this.database.createPlaylist(userId, name);
    const playlist = this.database.getPlaylists(userId).find(item => item.id === id);
    return { status: 'ok' as const, playlist };
  }

  renamePlaylist(userId: string, playlistId: string, rawName: unknown): { status: PlaylistMutationStatus } {
    const source = this.database.getPlaylistSource(userId, playlistId);
    if (!source) return { status: 'not-found' };
    if (source !== 'manual') return { status: 'read-only' };

    const name = cleanName(rawName);
    if (!name) return { status: 'invalid-name' };
    if (!this.database.renamePlaylist(userId, playlistId, name)) {
      return { status: 'not-found' };
    }
    return { status: 'ok' };
  }

  deletePlaylist(userId: string, playlistId: string): { status: Exclude<PlaylistMutationStatus, 'invalid-name'> } {
    const source = this.database.getPlaylistSource(userId, playlistId);
    if (!source) return { status: 'not-found' };
    if (source !== 'manual') return { status: 'read-only' };

    if (!this.database.deletePlaylist(userId, playlistId)) {
      return { status: 'not-found' };
    }
    return { status: 'ok' };
  }

  setPlaylistTracks(userId: string, playlistId: string, value: unknown): {
    status: PlaylistTracksStatus;
    trackIds?: string[];
  } {
    const source = this.database.getPlaylistSource(userId, playlistId);
    if (!source) return { status: 'not-found' };
    if (source !== 'manual') return { status: 'read-only' };
    if (!Array.isArray(value)) return { status: 'invalid-tracks' };

    const trackIds = this.library.cleanTrackIds(value);
    if (!this.database.setPlaylistTracks(userId, playlistId, trackIds)) {
      return { status: 'not-found' };
    }
    return { status: 'ok', trackIds };
  }

  recordHistory(userId: string, trackId: string, playedAt?: string) {
    if (!this.library.getTrack(trackId)) return false;
    this.database.recordHistory(userId, trackId, playedAt);
    return true;
  }

  loadPlaybackState(userId: string) {
    return this.database.loadPlaybackState(userId);
  }

  savePlaybackState(userId: string, body: Partial<PlaybackState>) {
    const currentTrackId = typeof body.currentTrackId === 'string'
      && this.library.getTrack(body.currentTrackId)
      ? body.currentTrackId
      : null;
    const position = Number(body.position);
    const volume = Number(body.volume);
    const baseQueueIds = this.library.cleanTrackIds(body.baseQueueIds);
    const queueIds = this.library.cleanTrackIds(body.queueIds);

    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(volume)) {
      return null;
    }

    if (currentTrackId && !queueIds.includes(currentTrackId)) queueIds.unshift(currentTrackId);
    if (currentTrackId && !baseQueueIds.includes(currentTrackId)) baseQueueIds.unshift(currentTrackId);

    return this.database.savePlaybackState(userId, {
      currentTrackId,
      position,
      volume: Math.max(0, Math.min(1, volume)),
      shuffle: Boolean(body.shuffle),
      repeatMode: cleanRepeatMode(body.repeatMode),
      wasPlaying: Boolean(body.wasPlaying),
      baseQueueIds,
      queueIds
    });
  }
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function cleanRepeatMode(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off';
}
