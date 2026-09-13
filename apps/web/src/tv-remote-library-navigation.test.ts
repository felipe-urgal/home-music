import { describe, expect, it } from 'vitest';
import {
  backTvRemoteLibraryLocation,
  shouldShowTvRemoteLibrarySearch,
  type TvRemoteLibraryLocation
} from './tv-remote-library-navigation';

function expectBack(
  location: TvRemoteLibraryLocation,
  expected: TvRemoteLibraryLocation | null
) {
  expect(backTvRemoteLibraryLocation(location)).toEqual(expected);
}

describe('TV remote library navigation', () => {
  it('walks back through folders one level at a time before leaving the library', () => {
    expectBack(
      { kind: 'folders', folderPath: 'MPB/Elis Regina/Elis & Tom' },
      { kind: 'folders', folderPath: 'MPB/Elis Regina' }
    );
    expectBack(
      { kind: 'folders', folderPath: 'MPB' },
      { kind: 'folders', folderPath: '' }
    );
    expectBack(
      { kind: 'folders', folderPath: '' },
      { kind: 'root' }
    );
    expectBack({ kind: 'root' }, null);
  });

  it('returns from a playlist to Playlists, then Biblioteca, then Controle', () => {
    expectBack(
      { kind: 'playlist', playlistId: 'playlist-1' },
      { kind: 'playlists' }
    );
    expectBack({ kind: 'playlists' }, { kind: 'root' });
    expectBack({ kind: 'root' }, null);
  });

  it('shows contextual search only inside a concrete folder or playlist', () => {
    expect(shouldShowTvRemoteLibrarySearch({ kind: 'root' })).toBe(false);
    expect(shouldShowTvRemoteLibrarySearch({ kind: 'folders', folderPath: '' })).toBe(false);
    expect(shouldShowTvRemoteLibrarySearch({ kind: 'playlists' })).toBe(false);
    expect(shouldShowTvRemoteLibrarySearch({ kind: 'folders', folderPath: 'MPB' })).toBe(true);
    expect(shouldShowTvRemoteLibrarySearch({ kind: 'playlist', playlistId: 'playlist-1' })).toBe(true);
  });
});
