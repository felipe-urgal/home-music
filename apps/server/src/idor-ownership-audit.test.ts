import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PlaybackState } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function indexedTrack(id: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'IDOR',
    folderPath: 'IDOR',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: `/music/${id}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

function insertUser(databasePath: string, id: string, createdAt: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
    `).run(id, id, id, `hash-${id}`, createdAt, createdAt, createdAt);
  } finally {
    db.close();
  }
}

function playbackState(trackId: string): Omit<PlaybackState, 'updatedAt'> {
  return {
    currentTrackId: trackId,
    position: trackId === 'a' ? 11 : 22,
    volume: trackId === 'a' ? 0.4 : 0.8,
    shuffle: trackId === 'b',
    repeatMode: trackId === 'a' ? 'one' : 'all',
    wasPlaying: true,
    baseQueueIds: [trackId],
    queueIds: [trackId]
  };
}

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-idor-ownership-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('IDs conhecidos não atravessam ownership de dados pessoais', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, USER_A, '2026-08-26T10:00:00.000Z');
    insertUser(databasePath, USER_B, '2026-08-26T11:00:00.000Z');
    database.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');

    database.setFavorite(USER_A, 'a', true);
    database.setFavorite(USER_B, 'b', true);
    assert.deepEqual(database.getFavoriteIds(USER_A), ['a']);
    assert.deepEqual(database.getFavoriteIds(USER_B), ['b']);

    database.recordHistory(USER_A, 'a', '2026-08-26T12:01:00.000Z');
    database.recordHistory(USER_B, 'b', '2026-08-26T12:02:00.000Z');
    assert.deepEqual(database.getHistory(USER_A).map(item => item.track.id), ['a']);
    assert.deepEqual(database.getHistory(USER_B).map(item => item.track.id), ['b']);
    assert.equal(database.getStatistics(USER_A, 'all').totalPlays, 1);
    assert.equal(database.getStatistics(USER_B, 'all').totalPlays, 1);

    database.savePlaybackState(USER_A, playbackState('a'));
    database.savePlaybackState(USER_B, playbackState('b'));
    assert.equal(database.loadPlaybackState(USER_A).currentTrackId, 'a');
    assert.equal(database.loadPlaybackState(USER_B).currentTrackId, 'b');

    const playlistA = database.createPlaylist(USER_A, 'Playlist A');
    const playlistB = database.createPlaylist(USER_B, 'Playlist B');
    assert.equal(database.setPlaylistTracks(USER_A, playlistA, ['a']), true);
    assert.equal(database.setPlaylistTracks(USER_B, playlistB, ['b']), true);

    assert.equal(database.getPlaylistSource(USER_A, playlistB), null);
    assert.equal(database.renamePlaylist(USER_A, playlistB, 'Tentativa cruzada'), false);
    assert.equal(database.setPlaylistTracks(USER_A, playlistB, ['a']), false);
    assert.equal(database.deletePlaylist(USER_A, playlistB), false);

    assert.equal(database.getPlaylists(USER_A).some(item => item.id === playlistB), false);
    assert.deepEqual(
      database.getPlaylists(USER_B).find(item => item.id === playlistB)?.trackIds,
      ['b']
    );

    assert.equal(database.renamePlaylist(USER_A, playlistA, 'Playlist A atualizada'), true);
    assert.equal(database.setPlaylistTracks(USER_A, playlistA, ['b', 'a']), true);
    assert.deepEqual(
      database.getPlaylists(USER_A).find(item => item.id === playlistA)?.trackIds,
      ['b', 'a']
    );

    database.close();
  });
});

test('playlists Rekordbox continuam compartilhadas sem abrir mutação manual por ID', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, USER_A, '2026-08-26T10:00:00.000Z');
    insertUser(databasePath, USER_B, '2026-08-26T11:00:00.000Z');
    database.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');

    database.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'DJ\u001fAudit', name: 'DJ Audit', trackIds: ['a', 'b'] }
    ]);

    const sharedA = database.getPlaylists(USER_A).find(item => item.source === 'rekordbox');
    const sharedB = database.getPlaylists(USER_B).find(item => item.source === 'rekordbox');
    assert.ok(sharedA);
    assert.ok(sharedB);
    assert.equal(sharedA.id, sharedB.id);
    assert.deepEqual(sharedA.trackIds, ['a', 'b']);
    assert.deepEqual(sharedB.trackIds, ['a', 'b']);

    assert.equal(database.renamePlaylist(USER_A, sharedA.id, 'Não permitido'), false);
    assert.equal(database.setPlaylistTracks(USER_A, sharedA.id, ['b']), false);
    assert.equal(database.deletePlaylist(USER_A, sharedA.id), false);

    database.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'DJ\u001fAudit', name: 'DJ Audit atualizada', trackIds: ['b'] }
    ]);
    const updated = database.getPlaylists(USER_B).find(item => item.id === sharedA.id);
    assert.equal(updated?.name, 'DJ Audit atualizada');
    assert.deepEqual(updated?.trackIds, ['b']);

    database.close();
  });
});
