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
    folder: 'Favoritos',
    folderPath: 'Favoritos',
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

function replaceFavoritesWithLegacyV6(databasePath: string, rows: Array<{ trackId: string; createdAt: string }>) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    db.exec(`
      DROP TABLE favorites;
      DROP TABLE legacy_favorites_pending;
      CREATE TABLE favorites (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO favorites(track_id, created_at) VALUES (?, ?);');
    for (const row of rows) insert.run(row.trackId, row.createdAt);
    db.exec('PRAGMA user_version = 6;');
  } finally {
    db.close();
  }
}

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-favorites-ownership-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('favoritos são isolados por usuário e a mesma faixa pode pertencer a contas diferentes', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z');
    database.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');

    database.setFavorite(FIRST_USER_ID, 'a', true);
    database.setFavorite(FIRST_USER_ID, 'b', true);
    database.setFavorite(SECOND_USER_ID, 'a', true);

    assert.deepEqual(database.getFavoriteIds(FIRST_USER_ID).sort(), ['a', 'b']);
    assert.deepEqual(database.getFavoriteIds(SECOND_USER_ID), ['a']);

    database.setFavorite(FIRST_USER_ID, 'a', false);
    assert.deepEqual(database.getFavoriteIds(FIRST_USER_ID), ['b']);
    assert.deepEqual(database.getFavoriteIds(SECOND_USER_ID), ['a']);

    assert.throws(() => database.getFavoriteIds(''), RangeError);
    assert.throws(() => database.setFavorite('', 'a', true), RangeError);
    assert.throws(() => database.setFavorite('usuario-inexistente', 'a', true));

    database.close();
  });
});

test('schema v7 exige dono em todo favorito persistido', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    database.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    database.close();

    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA foreign_keys = ON;');
    try {
      const columns = raw.prepare('PRAGMA table_info(favorites);').all() as Array<{
        name?: string;
        notnull?: number;
      }>;
      assert.equal(columns.find(column => column.name === 'user_id')?.notnull, 1);
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO favorites(user_id, track_id, created_at)
          VALUES (NULL, 'a', '2026-08-26T12:00:00.000Z');
        `).run();
      });
    } finally {
      raw.close();
    }
  });
});

test('migration v6 atribui favoritos globais ao primeiro usuário criado sem alterar timestamps', async () => {
  await withDatabase(async databasePath => {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    prepared.close();

    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z', 'admin');
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'user');
    replaceFavoritesWithLegacyV6(databasePath, [{
      trackId: 'a',
      createdAt: '2026-08-20T09:30:00.000Z'
    }]);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 7);
    assert.deepEqual(migrated.getFavoriteIds(FIRST_USER_ID), ['a']);
    assert.deepEqual(migrated.getFavoriteIds(SECOND_USER_ID), []);
    migrated.close();

    const raw = new DatabaseSync(databasePath);
    try {
      const row = raw.prepare(`
        SELECT user_id, track_id, created_at
        FROM favorites
        WHERE track_id = 'a';
      `).get() as Record<string, unknown>;
      assert.equal(row.user_id, FIRST_USER_ID);
      assert.equal(row.track_id, 'a');
      assert.equal(row.created_at, '2026-08-20T09:30:00.000Z');
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_favorites_pending;').get() as Record<string, unknown>).count),
        0
      );
    } finally {
      raw.close();
    }
  });
});

test('migration pré-bootstrap guarda favoritos fora da tabela ativa e bootstrap os reivindica atomicamente', async () => {
  await withDatabase(async databasePath => {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    prepared.close();

    replaceFavoritesWithLegacyV6(databasePath, [{
      trackId: 'a',
      createdAt: '2026-08-20T09:30:00.000Z'
    }]);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 7);
    assert.deepEqual(migrated.getFavoriteIds(FIRST_USER_ID), []);
    migrated.close();

    const pending = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((pending.prepare('SELECT COUNT(*) AS count FROM favorites;').get() as Record<string, unknown>).count),
        0
      );
      const row = pending.prepare(`
        SELECT track_id, created_at
        FROM legacy_favorites_pending
        WHERE track_id = 'a';
      `).get() as Record<string, unknown>;
      assert.equal(row.track_id, 'a');
      assert.equal(row.created_at, '2026-08-20T09:30:00.000Z');
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
    assert.deepEqual(claimed.getFavoriteIds(FIRST_USER_ID), ['a']);
    claimed.close();

    const raw = new DatabaseSync(databasePath);
    try {
      const row = raw.prepare(`
        SELECT user_id, created_at FROM favorites WHERE track_id = 'a';
      `).get() as Record<string, unknown>;
      assert.equal(row.user_id, FIRST_USER_ID);
      assert.equal(row.created_at, '2026-08-20T09:30:00.000Z');
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_favorites_pending;').get() as Record<string, unknown>).count),
        0
      );
    } finally {
      raw.close();
    }
  });
});

test('bootstrap já inicializado recupera staging pendente para o primeiro usuário', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    database.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    database.close();
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');

    const raw = new DatabaseSync(databasePath);
    try {
      raw.prepare(`
        INSERT INTO legacy_favorites_pending(track_id, created_at)
        VALUES ('a', '2026-08-20T09:30:00.000Z');
      `).run();
    } finally {
      raw.close();
    }

    const result = await bootstrapInitialAdmin({
      databasePath,
      username: 'ignorado',
      password: 'senha-ignorada-segura-123'
    });
    assert.deepEqual(result, { status: 'already-initialized' });

    const recovered = new HomeMusicDatabase(databasePath);
    assert.deepEqual(recovered.getFavoriteIds(FIRST_USER_ID), ['a']);
    recovered.close();
  });
});
