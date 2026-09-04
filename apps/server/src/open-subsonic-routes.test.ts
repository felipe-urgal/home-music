import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Playlist, Track } from '@home-music/shared';
import { registerOpenSubsonicRoutes } from './open-subsonic-routes.js';

const tracks: Track[] = [
  {
    id: 'track-1',
    title: 'Primeira faixa',
    artist: 'Artista A',
    album: 'Álbum A',
    albumArtist: 'Artista A',
    folder: 'Biblioteca',
    folderPath: '',
    duration: 123,
    format: 'mp3',
    hasCover: true
  },
  {
    id: 'track-2',
    title: 'Segunda faixa',
    artist: 'Artista B',
    album: 'Álbum B',
    albumArtist: 'Artista B',
    folder: 'Biblioteca',
    folderPath: '',
    duration: 180,
    format: 'mp3',
    hasCover: false
  }
];

function responseBody(response: { body: string }) {
  return JSON.parse(response.body) as Record<string, any>;
}

function createPersonalFake() {
  const favorites = new Map<string, Set<string>>([
    ['user-a', new Set(['track-1'])],
    ['user-b', new Set()]
  ]);
  const playlists = new Map<string, Playlist[]>([
    ['user-a', [{
      id: 'playlist-a',
      name: 'Lista A',
      trackIds: ['track-1'],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      source: 'manual'
    }]],
    ['user-b', [{
      id: 'playlist-b',
      name: 'Lista B',
      trackIds: ['track-2'],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      source: 'manual'
    }]]
  ]);
  const history: Array<{ userId: string; trackId: string }> = [];

  return {
    favorites,
    playlists,
    history,
    service: {
      getFavoriteIds(userId: string) {
        return [...(favorites.get(userId) ?? new Set<string>())];
      },
      setFavorite(userId: string, trackId: string, favorite: unknown) {
        const set = favorites.get(userId) ?? new Set<string>();
        favorites.set(userId, set);
        if (favorite === true) set.add(trackId);
        else set.delete(trackId);
        return { status: 'ok' as const, favorite: Boolean(favorite) };
      },
      getPlaylists(userId: string) {
        return playlists.get(userId) ?? [];
      },
      createPlaylist(userId: string, name: unknown) {
        if (typeof name !== 'string' || !name.trim()) return { status: 'invalid-name' as const };
        const playlist: Playlist = {
          id: `created-${userId}`,
          name: name.trim(),
          trackIds: [],
          createdAt: '2026-09-04T00:00:00.000Z',
          updatedAt: '2026-09-04T00:00:00.000Z',
          source: 'manual'
        };
        playlists.set(userId, [...(playlists.get(userId) ?? []), playlist]);
        return { status: 'ok' as const, playlist };
      },
      renamePlaylist(userId: string, playlistId: string, name: unknown) {
        const playlist = (playlists.get(userId) ?? []).find(item => item.id === playlistId);
        if (!playlist) return { status: 'not-found' as const };
        if (typeof name !== 'string' || !name.trim()) return { status: 'invalid-name' as const };
        playlist.name = name.trim();
        return { status: 'ok' as const };
      },
      deletePlaylist(userId: string, playlistId: string) {
        const current = playlists.get(userId) ?? [];
        if (!current.some(item => item.id === playlistId)) return { status: 'not-found' as const };
        playlists.set(userId, current.filter(item => item.id !== playlistId));
        return { status: 'ok' as const };
      },
      setPlaylistTracks(userId: string, playlistId: string, trackIds: unknown) {
        const playlist = (playlists.get(userId) ?? []).find(item => item.id === playlistId);
        if (!playlist) return { status: 'not-found' as const };
        if (!Array.isArray(trackIds)) return { status: 'invalid-tracks' as const };
        playlist.trackIds = trackIds.filter((value): value is string => typeof value === 'string');
        return { status: 'ok' as const, trackIds: playlist.trackIds };
      },
      recordHistory(userId: string, trackId: string) {
        history.push({ userId, trackId });
        return true;
      }
    }
  };
}

async function createTestServer(mediaPath: string) {
  const personal = createPersonalFake();
  const app = Fastify({ logger: false });

  registerOpenSubsonicRoutes(app, {
    library: {
      listPublicTracks: () => tracks,
      getTrack: id => {
        const track = tracks.find(item => item.id === id);
        if (!track) return undefined;
        return {
          ...track,
          filePath: '/secret/MUSIC_DIR/never-expose.mp3',
          mimeType: 'audio/mpeg',
          fileSize: 10,
          mtimeMs: 1
        };
      }
    },
    credentials: {
      authenticate: rawKey => {
        if (rawKey === 'key-a') return {
          keyId: 'api-a',
          user: { id: 'user-a', username: 'alice', role: 'user' as const }
        };
        if (rawKey === 'key-b') return {
          keyId: 'api-b',
          user: { id: 'user-b', username: 'bob', role: 'user' as const }
        };
        return null;
      }
    },
    personal: personal.service,
    media: {
      ffmpegAvailable: false,
      async openTrack(id: string) {
        if (id !== 'track-1') return null;
        const handle = await open(mediaPath, 'r');
        return {
          track: {
            ...tracks[0],
            filePath: mediaPath,
            mimeType: 'audio/mpeg',
            fileSize: 10,
            mtimeMs: 1
          },
          opened: { handle, path: mediaPath, stat: await handle.stat() }
        };
      },
      async cover(id: string) {
        return id === 'track-1'
          ? { format: 'image/jpeg', data: Buffer.from([1, 2, 3]) }
          : null;
      },
      async lyrics(id: string) {
        return id === 'track-1'
          ? { source: 'lrc' as const, synchronized: true, lines: [{ time: 1.25, text: 'Linha' }] }
          : null;
      },
      async prepareTranscode() {
        return null;
      }
    }
  });

  await app.ready();
  return { app, personal };
}

test('OpenSubsonic anuncia somente extensions implementadas e exige API key dedicada', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-contract-'));
  const mediaPath = path.join(root, 'track.mp3');
  await writeFile(mediaPath, Buffer.from('0123456789'));
  const { app } = await createTestServer(mediaPath);

  try {
    const extensions = await app.inject({
      method: 'GET',
      url: '/rest/getOpenSubsonicExtensions.view?f=json'
    });
    assert.equal(extensions.statusCode, 200);
    assert.deepEqual(
      responseBody(extensions)['subsonic-response'].openSubsonicExtensions,
      [
        { name: 'apiKeyAuthentication', versions: [1] },
        { name: 'songLyrics', versions: [1] }
      ]
    );

    const missing = await app.inject({ method: 'GET', url: '/rest/ping.view?f=json' });
    assert.equal(responseBody(missing)['subsonic-response'].error.code, 44);

    const password = await app.inject({ method: 'GET', url: '/rest/ping.view?u=alice&p=secret&f=json' });
    assert.equal(responseBody(password)['subsonic-response'].error.code, 42);

    const conflict = await app.inject({ method: 'GET', url: '/rest/ping.view?apiKey=key-a&u=alice&f=json' });
    assert.equal(responseBody(conflict)['subsonic-response'].error.code, 43);

    const ping = await app.inject({ method: 'GET', url: '/rest/ping.view?apiKey=key-a&f=json' });
    assert.equal(responseBody(ping)['subsonic-response'].status, 'ok');
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenSubsonic projeta biblioteca e busca sem expor MUSIC_DIR', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-library-'));
  const mediaPath = path.join(root, 'track.mp3');
  await writeFile(mediaPath, Buffer.from('0123456789'));
  const { app } = await createTestServer(mediaPath);

  try {
    const artists = await app.inject({ method: 'GET', url: '/rest/getArtists.view?apiKey=key-a&f=json' });
    const artistsBody = responseBody(artists);
    const artistIndexes = artistsBody['subsonic-response'].artists.index;
    assert.equal(artistIndexes.length, 1);
    assert.equal(artistIndexes[0].artist.length, 2);
    assert.equal(artists.body.includes('/secret/MUSIC_DIR'), false);

    const search = await app.inject({
      method: 'GET',
      url: '/rest/search3.view?apiKey=key-a&f=json&query=segunda&songCount=10&artistCount=10&albumCount=10'
    });
    const songs = responseBody(search)['subsonic-response'].searchResult3.song;
    assert.equal(songs.length, 1);
    assert.equal(songs[0].id, 'track-2');
    assert.equal(search.body.includes('filePath'), false);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenSubsonic preserva Range na reprodução e adapta artwork/lyrics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-media-'));
  const mediaPath = path.join(root, 'track.mp3');
  await writeFile(mediaPath, Buffer.from('0123456789'));
  const { app } = await createTestServer(mediaPath);

  try {
    const stream = await app.inject({
      method: 'GET',
      url: '/rest/stream.view?apiKey=key-a&f=json&id=track-1',
      headers: { range: 'bytes=2-5' }
    });
    assert.equal(stream.statusCode, 206);
    assert.equal(stream.headers['content-range'], 'bytes 2-5/10');
    assert.equal(stream.rawPayload.toString(), '2345');

    const cover = await app.inject({ method: 'GET', url: '/rest/getCoverArt.view?apiKey=key-a&id=track%3Atrack-1' });
    assert.equal(cover.statusCode, 200);
    assert.equal(cover.headers['content-type'], 'image/jpeg');
    assert.deepEqual([...cover.rawPayload], [1, 2, 3]);

    const lyrics = await app.inject({ method: 'GET', url: '/rest/getLyricsBySongId.view?apiKey=key-a&f=json&id=track-1' });
    const structured = responseBody(lyrics)['subsonic-response'].lyricsList.structuredLyrics[0];
    assert.equal(structured.synced, true);
    assert.deepEqual(structured.line, [{ start: 1250, value: 'Linha' }]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenSubsonic deriva ownership da API key para playlists, favoritos e scrobble', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-owner-'));
  const mediaPath = path.join(root, 'track.mp3');
  await writeFile(mediaPath, Buffer.from('0123456789'));
  const { app, personal } = await createTestServer(mediaPath);

  try {
    const crossUser = await app.inject({ method: 'GET', url: '/rest/getPlaylist.view?apiKey=key-a&f=json&id=playlist-b' });
    assert.equal(responseBody(crossUser)['subsonic-response'].error.code, 70);

    const explicitOtherUsername = await app.inject({ method: 'GET', url: '/rest/getPlaylists.view?apiKey=key-a&f=json&username=bob' });
    assert.equal(responseBody(explicitOtherUsername)['subsonic-response'].error.code, 50);

    const star = await app.inject({ method: 'GET', url: '/rest/star.view?apiKey=key-b&f=json&id=track-2' });
    assert.equal(responseBody(star)['subsonic-response'].status, 'ok');
    assert.equal(personal.favorites.get('user-b')?.has('track-2'), true);
    assert.equal(personal.favorites.get('user-a')?.has('track-2'), false);

    const create = await app.inject({
      method: 'GET',
      url: '/rest/createPlaylist.view?apiKey=key-b&f=json&name=Nova&songId=track-2'
    });
    assert.equal(responseBody(create)['subsonic-response'].playlist.name, 'Nova');
    assert.equal(personal.playlists.get('user-b')?.some(item => item.name === 'Nova'), true);
    assert.equal(personal.playlists.get('user-a')?.some(item => item.name === 'Nova'), false);

    const scrobble = await app.inject({ method: 'GET', url: '/rest/scrobble.view?apiKey=key-b&f=json&id=track-2&submission=true' });
    assert.equal(responseBody(scrobble)['subsonic-response'].status, 'ok');
    assert.deepEqual(personal.history, [{ userId: 'user-b', trackId: 'track-2' }]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenSubsonic falha explicitamente para endpoint fora do subset', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-open-subsonic-unsupported-'));
  const mediaPath = path.join(root, 'track.mp3');
  await writeFile(mediaPath, Buffer.from('0123456789'));
  const { app } = await createTestServer(mediaPath);

  try {
    const response = await app.inject({ method: 'GET', url: '/rest/getRandomSongs.view?apiKey=key-a&f=json' });
    const body = responseBody(response)['subsonic-response'];
    assert.equal(body.status, 'failed');
    assert.equal(body.error.code, 0);
    assert.match(body.error.message, /não suportado/i);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
