import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerOpenSubsonicRoutes } from './open-subsonic-routes.js';

const track = {
  id: 'track-1',
  filePath: '/music/track-1.flac',
  title: 'Faixa 1',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista',
  folder: 'Álbum',
  folderPath: 'Artista/Álbum',
  duration: 180,
  format: 'flac',
  hasCover: false,
  replayGainTrackDb: null,
  replayGainAlbumDb: null,
  mimeType: 'audio/flac',
  fileSize: 1234,
  mtimeMs: 1_700_000_000_000
};

function createServer() {
  let catalogReads = 0;
  let favoriteReads = 0;
  const app = Fastify({ logger: false });

  registerOpenSubsonicRoutes(app, {
    library: {
      listPublicTracks: () => {
        catalogReads += 1;
        return [track];
      },
      getTrack: id => id === track.id ? track : undefined
    },
    credentials: {
      authenticate: rawKey => rawKey === 'key-a'
        ? { keyId: 'api-a', user: { id: 'user-a', username: 'alice', role: 'user' as const } }
        : null
    },
    personal: {
      getFavoriteIds: () => {
        favoriteReads += 1;
        return [];
      },
      setFavorite: () => ({ status: 'ok' as const, favorite: false }),
      getPlaylists: () => [],
      createPlaylist: () => ({ status: 'invalid-name' as const }),
      renamePlaylist: () => ({ status: 'not-found' as const }),
      deletePlaylist: () => ({ status: 'not-found' as const }),
      setPlaylistTracks: () => ({ status: 'not-found' as const }),
      recordHistory: () => false
    },
    media: {
      ffmpegAvailable: false,
      openTrack: async () => null,
      cover: async () => null,
      lyrics: async () => null,
      prepareTranscode: async () => null
    }
  });

  return {
    app,
    reads: () => ({ catalogReads, favoriteReads })
  };
}

test('endpoints por track não constroem catálogo nem favoritos globais', async () => {
  const { app, reads } = createServer();
  await app.ready();

  try {
    const urls = [
      '/rest/stream.view?apiKey=key-a&id=track-1',
      '/rest/getCoverArt.view?apiKey=key-a&id=track-1',
      '/rest/getLyricsBySongId.view?apiKey=key-a&id=track-1',
      '/rest/star.view?apiKey=key-a&id=track-1',
      '/rest/scrobble.view?apiKey=key-a&id=track-1',
      '/rest/getMusicFolders.view?apiKey=key-a'
    ];

    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200);
    }

    assert.deepEqual(reads(), { catalogReads: 0, favoriteReads: 0 });
  } finally {
    await app.close();
  }
});

test('projeção de catálogo é construída somente quando um endpoint realmente a consome', async () => {
  const { app, reads } = createServer();
  await app.ready();

  try {
    const artists = await app.inject({ method: 'GET', url: '/rest/getArtists.view?apiKey=key-a' });
    assert.equal(artists.json()['subsonic-response'].status, 'ok');
    assert.deepEqual(reads(), { catalogReads: 1, favoriteReads: 0 });

    const starred = await app.inject({ method: 'GET', url: '/rest/getStarred2.view?apiKey=key-a' });
    assert.equal(starred.json()['subsonic-response'].status, 'ok');
    assert.deepEqual(reads(), { catalogReads: 2, favoriteReads: 1 });
  } finally {
    await app.close();
  }
});
