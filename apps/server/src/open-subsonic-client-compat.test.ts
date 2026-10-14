import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerOpenSubsonicProtocolGuard } from './open-subsonic-protocol.js';
import { registerOpenSubsonicRoutes } from './open-subsonic-routes.js';

function createServer() {
  const app = Fastify({ logger: false });
  registerOpenSubsonicProtocolGuard(app);
  registerOpenSubsonicRoutes(app, {
    library: {
      listPublicTracks: () => [],
      getTrack: () => undefined
    },
    credentials: {
      authenticate: rawKey => rawKey === 'key-a'
        ? { keyId: 'api-a', user: { id: 'user-a', username: 'alice', role: 'user' as const } }
        : null
    },
    personal: {
      getFavoriteIds: () => [],
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
  return app;
}

test('OpenSubsonic aceita app key como password legado sem aceitar senha web', async () => {
  const app = createServer();
  await app.ready();

  try {
    const legacy = await app.inject({
      method: 'GET',
      url: '/rest/getUser.view?u=alice&p=key-a&username=alice&v=1.13.0&c=Feishin&f=json'
    });
    const legacyBody = legacy.json()['subsonic-response'];
    assert.equal(legacyBody.status, 'ok');
    assert.equal(legacyBody.user.username, 'alice');
    assert.equal(legacyBody.user.streamRole, true);
    assert.equal(legacyBody.user.coverArtRole, true);
    assert.equal(legacyBody.user.playlistRole, true);
    assert.equal(legacyBody.user.scrobblingEnabled, true);
    assert.equal(legacyBody.user.downloadRole, false);
    assert.equal(legacyBody.user.uploadRole, false);
    assert.deepEqual(legacyBody.user.folder, ['1']);

    const wrongPassword = await app.inject({
      method: 'GET',
      url: '/rest/getUser.view?u=alice&p=web-password&username=alice&v=1.13.0&c=Feishin&f=json'
    });
    const wrongBody = wrongPassword.json()['subsonic-response'];
    assert.equal(wrongBody.status, 'failed');
    assert.equal(wrongBody.error.code, 40);
  } finally {
    await app.close();
  }
});

test('OpenSubsonic preserva apiKey nativa e impede username cruzado no getUser', async () => {
  const app = createServer();
  await app.ready();

  try {
    const native = await app.inject({
      method: 'GET',
      url: '/rest/getUser.view?apiKey=key-a&username=alice&v=1.16.1&c=home-music-tests&f=json'
    });
    assert.equal(native.json()['subsonic-response'].status, 'ok');

    const crossUser = await app.inject({
      method: 'GET',
      url: '/rest/getUser.view?apiKey=key-a&username=bob&v=1.16.1&c=home-music-tests&f=json'
    });
    const crossBody = crossUser.json()['subsonic-response'];
    assert.equal(crossBody.status, 'failed');
    assert.equal(crossBody.error.code, 50);
  } finally {
    await app.close();
  }
});

test('OpenSubsonic explicita contrato JSON-only para f=json, ausente e formatos não suportados', async () => {
  const app = createServer();
  await app.ready();

  try {
    for (const suffix of ['&f=json', '']) {
      const response = await app.inject({
        method: 'GET',
        url: `/rest/ping.view?apiKey=key-a&v=1.16.1&c=contract-tests${suffix}`
      });
      assert.equal(response.statusCode, 200);
      assert.ok((response.headers['content-type'] as string).startsWith('application/json'));
      assert.equal(response.json()['subsonic-response'].status, 'ok');
    }

    for (const suffix of ['&f=xml', '&f=jsonp', '&f=unknown']) {
      const response = await app.inject({
        method: 'GET',
        url: `/rest/ping.view?apiKey=key-a&v=1.16.1&c=contract-tests${suffix}`
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json()['subsonic-response'].status, 'failed');
      assert.equal(response.json()['subsonic-response'].error.code, 0);
    }
  } finally {
    await app.close();
  }
});

test('OpenSubsonic não anuncia endpoints de descoberta ainda não implementados', async () => {
  const app = createServer();
  await app.ready();

  try {
    for (const endpoint of ['getRandomSongs', 'getGenres', 'getSongsByGenre', 'getNowPlaying']) {
      const response = await app.inject({
        method: 'GET',
        url: `/rest/${endpoint}.view?apiKey=key-a&v=1.16.1&c=contract-tests&f=json`
      });
      const body = response.json()['subsonic-response'];
      assert.equal(response.statusCode, 200);
      assert.equal(body.status, 'failed');
      assert.equal(body.error.code, 0);
      assert.match(body.error.message, /não suportado/);
    }
  } finally {
    await app.close();
  }
});
