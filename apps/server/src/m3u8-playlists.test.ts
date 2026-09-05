import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerM3u8PlaylistRoutes } from './m3u8-playlist-routes.js';
import {
  M3U8_MAX_BYTES,
  M3u8InputError,
  exportM3u8,
  hashM3u8Content,
  previewM3u8,
  type M3u8LibrarySnapshot,
  type M3u8LibraryTrack
} from './m3u8-playlists.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function librarySnapshot(
  tracks: M3u8LibraryTrack[],
  enabledIds = tracks.map(track => track.id)
): M3u8LibrarySnapshot {
  const enabled = new Set(enabledIds);
  return {
    root: '/music',
    allTracks: tracks,
    getTrack(trackId: string) {
      if (!enabled.has(trackId)) return undefined;
      return tracks.find(track => track.id === trackId);
    }
  };
}

const library = librarySnapshot([
  { id: 'one', filePath: '/music/Artista/Album/one.mp3' },
  { id: 'two', filePath: '/music/Artista/Album/two.flac' }
]);

function manualPlaylist(id = 'playlist-a') {
  return {
    id,
    name: 'Minha playlist',
    trackIds: ['two', 'one'],
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    source: 'manual' as const
  };
}

test('preview resolve somente paths relativos seguros e mantém classificação transparente', () => {
  const preview = previewM3u8([
    '\uFEFF#EXTM3U',
    '#EXTINF:180,One',
    'Artista\\Album\\one.mp3',
    '../fora.mp3',
    'https://example.com/audio.mp3',
    'C:\\Music\\absolute.mp3',
    '/etc/passwd',
    'Artista/Album/missing.mp3',
    'Artista/Album/two.flac'
  ].join('\r\n'), library);

  assert.deepEqual(
    preview.entries.map(entry => entry.status),
    ['resolved', 'invalid', 'invalid', 'invalid', 'invalid', 'not-found', 'resolved']
  );
  assert.deepEqual(
    preview.entries.flatMap(entry => entry.status === 'resolved' ? [entry.trackId] : []),
    ['one', 'two']
  );
  assert.equal(preview.summary.resolved, 2);
  assert.equal(preview.summary.invalid, 4);
  assert.equal(preview.summary.notFound, 1);
});

test('preview não escolhe silenciosamente path ambíguo', () => {
  const ambiguousLibrary = librarySnapshot([
    { id: 'a', filePath: '/music/dup.mp3' },
    { id: 'b', filePath: '/music/dup.mp3' }
  ]);

  const preview = previewM3u8('dup.mp3\n', ambiguousLibrary);
  assert.equal(preview.entries[0]?.status, 'ambiguous');
  assert.equal(preview.summary.ambiguous, 1);
});

test('preview não anuncia como resolvida uma faixa desabilitada', () => {
  const disabledLibrary = librarySnapshot([
    { id: 'enabled', filePath: '/music/enabled.mp3' },
    { id: 'disabled', filePath: '/music/disabled.mp3' }
  ], ['enabled']);

  const preview = previewM3u8('enabled.mp3\ndisabled.mp3\n', disabledLibrary);
  assert.deepEqual(preview.entries.map(entry => entry.status), ['resolved', 'not-found']);
  assert.equal(preview.summary.resolved, 1);
  assert.equal(preview.summary.notFound, 1);
});

test('preview rejeita conteúdo acima do limite defensivo', () => {
  assert.throws(
    () => previewM3u8('a'.repeat(M3U8_MAX_BYTES + 1), library),
    error => error instanceof M3u8InputError
      && error.code === 'file-too-large'
      && error.statusCode === 413
  );
});

test('export preserva ordem e sinaliza qualquer faixa sem path portátil', () => {
  const exported = exportM3u8(['two', 'missing', 'one'], library);
  assert.equal(
    exported.content,
    '#EXTM3U\nArtista/Album/two.flac\nArtista/Album/one.mp3\n'
  );
  assert.deepEqual(exported.omittedTrackIds, ['missing']);
  assert.equal(exported.content.includes('/music/'), false);
});

test('export falha fechado para faixa desabilitada ou nome que não faz round-trip em M3U8', () => {
  const unsafeLibrary = librarySnapshot([
    { id: 'enabled', filePath: '/music/enabled.mp3' },
    { id: 'disabled', filePath: '/music/disabled.mp3' },
    { id: 'comment', filePath: '/music/#comment.mp3' },
    { id: 'space', filePath: '/music/ leading-space.mp3' },
    { id: 'backslash', filePath: '/music/folder\\track.mp3' }
  ], ['enabled', 'comment', 'space', 'backslash']);

  const exported = exportM3u8(
    ['enabled', 'disabled', 'comment', 'space', 'backslash'],
    unsafeLibrary
  );
  assert.equal(exported.content, '#EXTM3U\nenabled.mp3\n');
  assert.deepEqual(exported.omittedTrackIds, ['disabled', 'comment', 'space', 'backslash']);
});

test('import exige confirmação/hash e cria playlist somente para a sessão autenticada', async () => {
  const app = Fastify();
  const createdFor: string[] = [];
  const assigned: Array<{ userId: string; playlistId: string; trackIds: string[] }> = [];
  let deleted = 0;

  app.addHook('preHandler', async request => {
    request.user = { id: USER_A, username: 'alice', role: 'user' };
  });

  registerM3u8PlaylistRoutes(app, {
    getPlaylists(userId: string) {
      assert.equal(userId, USER_A);
      return [manualPlaylist()];
    },
    createPlaylist(userId: string, rawName: unknown) {
      assert.equal(rawName, 'Importada');
      createdFor.push(userId);
      return { status: 'ok' as const, playlist: manualPlaylist('created') };
    },
    setPlaylistTracks(userId: string, playlistId: string, value: unknown) {
      assert.equal(Array.isArray(value), true);
      const trackIds = value as string[];
      assigned.push({ userId, playlistId, trackIds });
      return { status: 'ok' as const, trackIds };
    },
    deletePlaylist() {
      deleted += 1;
      return { status: 'ok' as const };
    }
  }, library);

  const content = [
    '#EXTM3U',
    'Artista/Album/two.flac',
    '../fora.mp3',
    'Artista/Album/missing.mp3',
    'Artista/Album/one.mp3'
  ].join('\n');

  try {
    const withoutConfirmation = await app.inject({
      method: 'POST',
      url: '/api/playlists/m3u8/import',
      payload: {
        content,
        name: 'Importada',
        previewHash: hashM3u8Content(content),
        confirmed: false,
        userId: USER_B
      }
    });
    assert.equal(withoutConfirmation.statusCode, 409);
    assert.deepEqual(createdFor, []);

    const changedAfterPreview = await app.inject({
      method: 'POST',
      url: '/api/playlists/m3u8/import',
      payload: {
        content: `${content}\nArtista/Album/two.flac`,
        name: 'Importada',
        previewHash: hashM3u8Content(content),
        confirmed: true,
        userId: USER_B
      }
    });
    assert.equal(changedAfterPreview.statusCode, 409);
    assert.deepEqual(createdFor, []);

    const response = await app.inject({
      method: 'POST',
      url: '/api/playlists/m3u8/import',
      payload: {
        content,
        name: 'Importada',
        previewHash: hashM3u8Content(content),
        confirmed: true,
        userId: USER_B
      }
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(createdFor, [USER_A]);
    assert.deepEqual(assigned, [{
      userId: USER_A,
      playlistId: 'created',
      trackIds: ['two', 'one']
    }]);
    assert.equal(deleted, 0);

    const body = response.json();
    assert.equal(body.preview.summary.invalid, 1);
    assert.equal(body.preview.summary.notFound, 1);
    assert.equal(body.imported, 2);
  } finally {
    await app.close();
  }
});

test('export usa ownership da sessão, bloqueia playlist compartilhada e nunca vaza path absoluto', async () => {
  const app = Fastify();
  const requestedUsers: string[] = [];

  app.addHook('preHandler', async request => {
    request.user = { id: USER_A, username: 'alice', role: 'user' };
  });

  registerM3u8PlaylistRoutes(app, {
    getPlaylists(userId: string) {
      requestedUsers.push(userId);
      return [
        manualPlaylist(),
        {
          ...manualPlaylist('shared'),
          name: 'Rekordbox',
          source: 'rekordbox' as const
        }
      ];
    },
    createPlaylist() {
      return { status: 'invalid-name' as const };
    },
    setPlaylistTracks() {
      return { status: 'not-found' as const };
    },
    deletePlaylist() {
      return { status: 'not-found' as const };
    }
  }, library);

  try {
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/playlists/foreign/m3u8?userId=${encodeURIComponent(USER_B)}`
    });
    assert.equal(foreign.statusCode, 404);

    const shared = await app.inject({ method: 'GET', url: '/api/playlists/shared/m3u8' });
    assert.equal(shared.statusCode, 409);

    const response = await app.inject({ method: 'GET', url: '/api/playlists/playlist-a/m3u8' });
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.body,
      '#EXTM3U\nArtista/Album/two.flac\nArtista/Album/one.mp3\n'
    );
    assert.equal(response.body.includes('/music/'), false);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.match(response.headers['content-disposition'] ?? '', /playlist\.m3u8/);
    assert.deepEqual(requestedUsers, [USER_A, USER_A, USER_A]);
  } finally {
    await app.close();
  }
});
