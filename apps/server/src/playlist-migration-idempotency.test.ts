import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

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

test('migration v9 é idempotente quando user_version fica atrasado após o schema já estar aplicado', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-playlist-idempotency-'));
  const databasePath = path.join(directory, 'home-music.db');

  try {
    const database = new HomeMusicDatabase(databasePath);
    const raw = new DatabaseSync(databasePath);
    const now = '2026-08-26T10:00:00.000Z';
    try {
      raw.prepare(`
        INSERT INTO users(
          id, username, username_normalized, password_hash, role, enabled,
          password_must_change, created_at, updated_at, password_changed_at
        ) VALUES (?, 'admin', 'admin', 'hash-admin', 'admin', 1, 0, ?, ?, ?)
      `).run(USER_ID, now, now, now);
    } finally {
      raw.close();
    }

    database.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    const manualId = database.createPlaylist(USER_ID, 'Manual');
    assert.equal(database.setPlaylistTracks(USER_ID, manualId, ['a']), true);
    database.syncImportedPlaylists('rekordbox', [
      { sourceKey: 'DJ\u001fShared', name: 'DJ compartilhada', trackIds: ['a'] }
    ]);
    database.close();

    const downgraded = new DatabaseSync(databasePath);
    try {
      downgraded.exec('PRAGMA user_version = 8;');
    } finally {
      downgraded.close();
    }

    const recovered = new HomeMusicDatabase(databasePath);
    assert.equal(recovered.getSchemaVersion(), 12);
    const playlists = recovered.getPlaylists(USER_ID);
    assert.equal(playlists.filter(item => item.source === 'manual').length, 1);
    assert.equal(playlists.filter(item => item.source === 'rekordbox').length, 1);
    assert.deepEqual(playlists.find(item => item.id === manualId)?.trackIds, ['a']);
    recovered.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration v11 amplia ownership somente para smart playlists pessoais', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-playlist-v11-'));
  const databasePath = path.join(directory, 'home-music.db');
  const now = '2026-08-30T12:00:00.000Z';

  try {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.close();

    const legacyV10 = new DatabaseSync(databasePath);
    legacyV10.exec('PRAGMA foreign_keys = ON;');
    try {
      legacyV10.prepare(`
        INSERT INTO users(
          id, username, username_normalized, password_hash, role, enabled,
          password_must_change, created_at, updated_at, password_changed_at
        ) VALUES (?, 'admin', 'admin', 'hash-admin', 'admin', 1, 0, ?, ?, ?)
      `).run(USER_ID, now, now, now);
      legacyV10.exec(`
        DROP TRIGGER IF EXISTS trg_playlists_owner_insert;
        DROP TRIGGER IF EXISTS trg_playlists_owner_update;

        CREATE TRIGGER trg_playlists_owner_insert
        BEFORE INSERT ON playlists
        WHEN NEW.source NOT IN ('manual', 'rekordbox')
          OR (NEW.source = 'manual' AND NEW.owner_user_id IS NULL)
          OR (NEW.source = 'rekordbox' AND NEW.owner_user_id IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'ownership de playlist inválido');
        END;

        CREATE TRIGGER trg_playlists_owner_update
        BEFORE UPDATE OF source, owner_user_id ON playlists
        WHEN NEW.source NOT IN ('manual', 'rekordbox')
          OR (NEW.source = 'manual' AND NEW.owner_user_id IS NULL)
          OR (NEW.source = 'rekordbox' AND NEW.owner_user_id IS NOT NULL)
        BEGIN
          SELECT RAISE(ABORT, 'ownership de playlist inválido');
        END;

        PRAGMA user_version = 10;
      `);
      assert.throws(() => {
        legacyV10.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('smart-before-v11', 'Smart antiga', ?, ?, 'smart', '{}', ?)
        `).run(now, now, USER_ID);
      });
    } finally {
      legacyV10.close();
    }

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 12);
    migrated.close();

    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA foreign_keys = ON;');
    try {
      raw.prepare(`
        INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
        VALUES ('smart-after-v11', 'Smart válida', ?, ?, 'smart', '{}', ?)
      `).run(now, now, USER_ID);

      assert.throws(() => {
        raw.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('smart-sem-dono', 'Smart inválida', ?, ?, 'smart', '{}', NULL)
        `).run(now, now);
      });
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('rekordbox-com-dono', 'Rekordbox inválida', ?, ?, 'rekordbox', 'shared', ?)
        `).run(now, now, USER_ID);
      });
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
          VALUES ('fonte-invalida', 'Fonte inválida', ?, ?, 'outra', NULL, ?)
        `).run(now, now, USER_ID);
      });
    } finally {
      raw.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
