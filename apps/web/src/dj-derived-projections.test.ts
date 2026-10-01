import { describe, expect, it } from 'vitest';
import type { Playlist, Track } from '@home-music/shared';
import { buildDjDeckPanelState } from './dj-deck-panel-state';
import { buildDjLibrarySources, tracksForDjLibrarySource } from './dj-library-source';
import { EMPTY_DJ_SYNC_STATE } from './dj-sync-state';

function track(id: string, folderPath = ''): Track {
  return {
    id,
    title: id,
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Artist',
    folder: folderPath || 'Sem pasta',
    folderPath,
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
}

describe('DJ derived projections', () => {
  it('resolves deck track from the indexed map', () => {
    const selected = track('target');
    const tracksById = new Map<string, Track>([['target', selected]]);
    const panel = buildDjDeckPanelState({
      deck: 'a',
      snapshot: {
        deck: 'a',
        trackId: 'target',
        source: '/api/tracks/target/stream',
        playing: true,
        currentTimeSeconds: 1,
        durationSeconds: 180,
        playbackRate: 1,
        volume: 1,
        errorCode: null
      },
      tracksById,
      cuePointSeconds: null,
      syncState: EMPTY_DJ_SYNC_STATE,
      channelVolume: 1,
      meterLevel: 0.5
    });
    expect(panel.track).toBe(selected);
  });

  it('resolves playlist tracks through the same O(1) index', () => {
    const tracks = [track('a', 'House'), track('b', 'Techno')];
    const playlists: Playlist[] = [{
      id: 'p1',
      name: 'Set',
      trackIds: ['b', 'a'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      source: 'manual'
    }];
    const byId = new Map(tracks.map(item => [item.id, item]));
    expect(tracksForDjLibrarySource('playlist:p1', tracks, playlists, byId).map(item => item.id))
      .toEqual(['b', 'a']);
    expect(buildDjLibrarySources(tracks, playlists).map(source => source.value))
      .toContain('folder:House');
  });
});
