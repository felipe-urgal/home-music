import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

const FIRST_USER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_USER_ID = '22222222-2222-4222-8222-222222222222';

function indexedTrack(id: string): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Playlists',
    folderPath: 'Playlists',
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

function insertUser(
  databasePath: string,
  id: string,
  createdAt: string,
  role: 'admin' | 'user' = 'user'
) {
  const db = new DatabaseSync(databasePath);
  try {
    db.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
    `).run(id, id, id, `hash-${id}`, role, createdAt, createdAt, createdAt);
  } finally {
    db.close();
  }
}

function createLegacyV8Database(databasePath: string, includeUsers: boolean) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL CHECK(length(username) BETWEEN 1 AND 120),
        username_normalized TEXT NOT NULL UNIQUE CHECK(length(username_normalized) BETWEEN 1 AND 120),
        password_hash TEXT NOT NULL CHECK(length(password_hash) > 0),
        role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        password_must_change INTEGER NOT NULL DEFAULT 0 CHECK(password_must_change IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        password_changed_at TEXT
      );

      CREATE TABLE tracks (
        id TEXT PRIMARY KEY
      );

      CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        source_key TEXT
      );

      CREATE TABLE playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, position),
        UNIQUE (playlist_id, track_id)
      );

      INSERT INTO tracks(id) VALUES ('a'), ('b');
      INSERT INTO playlists(id, name, created_at, updated_at, source, source_key)
      VALUES
        ('manual-old', 'Manual antiga', '2026-08-20T09:00:00.000Z', '2026-08-21T10:00:00.000Z', 'manual', NULL),
        ('rekordbox-old', 'DJ compartilhada', '2026-08-20T11:00:00.000Z', '2026-08-21T12:00:00.000Z', 'rekordbox', 'DJ\u001fShared');
      INSERT INTO playlist_tracks(playlist_id, track_id, position)
      VALUES
        ('manual-old', 'b', 0),
        ('manual-old', 'a', 1),
        ('rekordbox-old', 'a', 0);

      PRAGMA user_version = 8;
    `);

    if (includeUsers) {
      const insert = db.prepare(`
        INSERT INTO users(
          id, username, username_normalized, password_hash, role, enabled,
          password_must_change, created_at, updated_at, password_changed_at
        ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
      `);
      insert.run(
        SECOND_USER_ID,
        'segundo',
        'segundo',
        'hash-segundo',
        'admin',
        '2026-08-26T11:00:00.000Z',
        '2026-08-26T11:00:00.000Z',
        '2026-08-26T11:00:00.000Z'
      );
      insert.run(
        FIRST_USER_ID,
        'primeiro',
        'primeiro',
        'hash-primeiro',
        'user',
        '2026-08-26T10:00:00.000Z',
        '2026-08-26T10:00:00.000Z',
        '2026-08-26T10:00:00.000Z'
      );
    }
  } finally {
    db.close();
  }
}

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-manual-playlist-ownership-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('playlists manuais são isoladas e Rekordbox permanece compartilhado e somente leitura', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z');
    database.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');

    const firstManualId = database.createPlaylist(FIRST_USER_ID, 'Primeira conta');
    const secondManualId = database.createPlaylist(SECOND_USER_ID, 'Segunda conta');
    assert.equal(database.setPlaylistTracks(FIRST_USER_ID, firstManualId, ['a']), true);
    assert.equal(database.setPlaylistTracks(SECOND_USER_ID, secondManualId, ['b']), true);

    database.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'DJ\u001fShared', name: 'DJ compartilhada', trackIds: ['a', 'b'] }
    ]);

    const first = database.getPlaylists(FIRST_USER_ID);
    const second = database.getPlaylists(SECOND_USER_ID);
    assert.deepEqual(first.filter(item => item.source === 'manual').map(item => item.id), [firstManualId]);
    assert.deepEqual(second.filter(item => item.source === 'manual').map(item => item.id), [secondManualId]);
    assert.equal(first.filter(item => item.source === 'rekordbox').length, 1);
    assert.equal(second.filter(item => item.source === 'rekordbox').length, 1);

    assert.equal(database.getPlaylistSource(FIRST_USER_ID, secondManualId), null);
    assert.equal(database.renamePlaylist(FIRST_USER_ID, secondManualId, 'Inválida'), false);
    assert.equal(database.deletePlaylist(FIRST_USER_ID, secondManualId), false);
    assert.equal(database.setPlaylistTracks(FIRST_USER_ID, secondManualId, ['a']), false);

    const sharedId = first.find(item => item.source === 'rekordbox')?.id;
    assert.ok(sharedId);
    assert.equal(database.getPlaylistSource(FIRST_USER_ID, sharedId), 'rekordbox');
    assert.equal(database.getPlaylistSource(SECOND_USER_ID, sharedId), 'rekordbox');
    assert.equal(database.renamePlaylist(FIRST_USER_ID, sharedId, 'Não pode'), false);
    assert.equal(database.deletePlaylist(FIRST_USER_ID, sharedId), false);
    assert.equal(database.setPlaylistTracks(FIRST_USER_ID, sharedId, ['a']), false);

    assert.equal(database.renamePlaylist(FIRST_USER_ID, firstManualId, 'Renomeada'), true);
    assert.equal(database.setPlaylistTracks(FIRST_USER_ID, firstManualId, ['b', 'a']), true);
    assert.deepEqual(
      database.getPlaylists(FIRST_USER_ID).find(item => item.id === firstManualId)?.trackIds,
      ['b', 'a']
    );

    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA foreign_keys = ON;');
    try {
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('manual-sem-dono', 'Inválida', '2026-08-26T12:00:00.000Z', '2026-08-26T12:00:00.000Z', 'manual', NULL, NULL);
        `).run();
      });
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('rekordbox-com-dono', 'Inválida', '2026-08-26T12:00:00.000Z', '2026-08-26T12:00:00.000Z', 'rekordbox', 'invalid', ?);
        `).run(FIRST_USER_ID);
      });
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('manual-dono-inexistente', 'Inválida', '2026-08-26T12:00:00.000Z', '2026-08-26T12:00:00.000Z', 'manual', NULL, 'usuario-inexistente');
        `).run();
      });
    } finally {
      raw.close();
    }

    database.close();
  });
});

test('migration v8 atribui apenas playlists manuais ao primeiro usuário e mantém Rekordbox compartilhado', async () => {
  await withDatabase(async databasePath => {
    createLegacyV8Database(databasePath, true);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 9);

    const first = migrated.getPlaylists(FIRST_USER_ID);
    const second = migrated.getPlaylists(SECOND_USER_ID);
    assert.deepEqual(first.map(item => item.id).sort(), ['manual-old', 'rekordbox-old']);
    assert.deepEqual(second.map(item => item.id), ['rekordbox-old']);
    assert.deepEqual(first.find(item => item.id === 'manual-old')?.trackIds, ['b', 'a']);
    assert.deepEqual(first.find(item => item.id === 'rekordbox-old')?.trackIds, ['a']);
    migrated.close();

    const raw = new DatabaseSync(databasePath);
    try {
      const rows = raw.prepare(`
        SELECT id, owner_user_id, created_at, updated_at
        FROM playlists
        ORDER BY id;
      `).all() as Array<Record<string, unknown>>;
      const manual = rows.find(row => row.id === 'manual-old');
      const rekordbox = rows.find(row => row.id === 'rekordbox-old');
      assert.equal(manual?.owner_user_id, FIRST_USER_ID);
      assert.equal(manual?.created_at, '2026-08-20T09:00:00.000Z');
      assert.equal(manual?.updated_at, '2026-08-21T10:00:00.000Z');
      assert.equal(rekordbox?.owner_user_id, null);
    } finally {
      raw.close();
    }
  });
});

test('migration pré-bootstrap mantém manual fora da tabela ativa e bootstrap a reivindica com as faixas', async () => {
  await withDatabase(async databasePath => {
    createLegacyV8Database(databasePath, false);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 9);
    assert.deepEqual(migrated.getPlaylists(FIRST_USER_ID).map(item => item.id), ['rekordbox-old']);
    migrated.close();

    const pending = new DatabaseSync(databasePath);
    try {
      const manual = pending.prepare(`
        SELECT id, name, created_at, updated_at
        FROM legacy_manual_playlists_pending
        WHERE id = 'manual-old';
      `).get() as Record<string, unknown>;
      assert.equal(manual.name, 'Manual antiga');
      const tracks = pending.prepare(`
        SELECT track_id, position
        FROM legacy_manual_playlist_tracks_pending
        WHERE playlist_id = 'manual-old'
        ORDER BY position;
      `).all() as Array<Record<string, unknown>>;
      assert.deepEqual(tracks.map(row => row.track_id), ['b', 'a']);
      assert.equal(
        Number((pending.prepare("SELECT COUNT(*) AS count FROM playlists WHERE source = 'manual';").get() as Record<string, unknown>).count),
        0
      );
      assert.equal(
        Number((pending.prepare("SELECT COUNT(*) AS count FROM playlists WHERE source = 'rekordbox';").get() as Record<string, unknown>).count),
        1
      );
    } finally {
      pending.close();
    }

    const bootstrap = await bootstrapInitialAdmin({
      databasePath,
      username: 'admin',
      password: 'senha-bootstrap-segura-123',
      createId: () => FIRST_USER_ID,
      now: () => new Date('2026-08-26T13:00:00.000Z')
    });
    assert.deepEqual(bootstrap, { status: 'created', userId: FIRST_USER_ID });

    const claimed = new HomeMusicDatabase(databasePath);
    const playlists = claimed.getPlaylists(FIRST_USER_ID);
    assert.deepEqual(playlists.map(item => item.id).sort(), ['manual-old', 'rekordbox-old']);
    assert.deepEqual(playlists.find(item => item.id === 'manual-old')?.trackIds, ['b', 'a']);
    claimed.close();

    const raw = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_manual_playlists_pending;').get() as Record<string, unknown>).count),
        0
      );
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_manual_playlist_tracks_pending;').get() as Record<string, unknown>).count),
        0
      );
      const owner = raw.prepare("SELECT owner_user_id FROM playlists WHERE id = 'manual-old';").get() as Record<string, unknown>;
      assert.equal(owner.owner_user_id, FIRST_USER_ID);
    } finally {
      raw.close();
    }
  });
});
