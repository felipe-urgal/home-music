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

function indexedTrack(id: string, duration = 180): IndexedTrack {
  return {
    id,
    title: `Faixa ${id}`,
    artist: id === 'b' ? 'Outro artista' : 'Artista',
    album: id === 'b' ? 'Outro álbum' : 'Álbum',
    albumArtist: id === 'b' ? 'Outro artista' : 'Artista',
    folder: 'Histórico',
    folderPath: 'Histórico',
    duration,
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

function replaceHistoryWithLegacyV7(
  databasePath: string,
  rows: Array<{ id?: number; trackId: string; playedAt: string }>
) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    db.exec(`
      DROP TABLE history;
      DROP TABLE legacy_history_pending;
      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at TEXT NOT NULL
      );
      CREATE INDEX idx_history_played_at ON history(played_at DESC);
    `);
    const insertWithId = db.prepare('INSERT INTO history(id, track_id, played_at) VALUES (?, ?, ?);');
    const insert = db.prepare('INSERT INTO history(track_id, played_at) VALUES (?, ?);');
    for (const row of rows) {
      if (row.id == null) insert.run(row.trackId, row.playedAt);
      else insertWithId.run(row.id, row.trackId, row.playedAt);
    }
    db.exec('PRAGMA user_version = 7;');
  } finally {
    db.close();
  }
}

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-history-ownership-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('histórico, limpeza e estatísticas são isolados por usuário', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z');
    database.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');

    database.recordHistory(FIRST_USER_ID, 'a', '2026-08-26T12:01:00.000Z');
    database.recordHistory(FIRST_USER_ID, 'a', '2026-08-26T12:02:00.000Z');
    database.recordHistory(SECOND_USER_ID, 'b', '2026-08-26T12:03:00.000Z');

    assert.deepEqual(database.getHistory(FIRST_USER_ID).map(item => item.track.id), ['a', 'a']);
    assert.deepEqual(database.getHistory(SECOND_USER_ID).map(item => item.track.id), ['b']);

    const firstStats = database.getStatistics(FIRST_USER_ID, 'all', new Date('2026-08-26T13:00:00.000Z'));
    const secondStats = database.getStatistics(SECOND_USER_ID, 'all', new Date('2026-08-26T13:00:00.000Z'));
    assert.equal(firstStats.totalPlays, 2);
    assert.equal(firstStats.topTracks[0].track.id, 'a');
    assert.equal(firstStats.topTracks[0].plays, 2);
    assert.equal(secondStats.totalPlays, 1);
    assert.equal(secondStats.topTracks[0].track.id, 'b');

    database.clearHistory(FIRST_USER_ID);
    assert.deepEqual(database.getHistory(FIRST_USER_ID), []);
    assert.deepEqual(database.getHistory(SECOND_USER_ID).map(item => item.track.id), ['b']);
    assert.equal(database.getStatistics(FIRST_USER_ID, 'all').totalPlays, 0);
    assert.equal(database.getStatistics(SECOND_USER_ID, 'all').totalPlays, 1);

    assert.throws(() => database.getHistory(''), RangeError);
    assert.throws(() => database.recordHistory('', 'a'), RangeError);
    assert.throws(() => database.clearHistory(''), RangeError);
    assert.throws(() => database.getStatistics('', 'all'), RangeError);
    assert.throws(() => database.recordHistory('usuario-inexistente', 'a'));

    database.close();
  });
});

test('capacidade do histórico é aplicada por usuário sem remover dados de outra conta', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z');
    database.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');

    database.recordHistory(SECOND_USER_ID, 'b', '2026-08-26T12:00:00.000Z');
    for (let index = 0; index < 2_001; index += 1) {
      database.recordHistory(
        FIRST_USER_ID,
        'a',
        new Date(Date.UTC(2026, 7, 26, 13, 0, 0, index)).toISOString()
      );
    }

    assert.equal(database.getHistory(FIRST_USER_ID, 500).length, 500);
    const raw = new DatabaseSync(databasePath);
    try {
      const firstCount = raw.prepare('SELECT COUNT(*) AS count FROM history WHERE user_id = ?;')
        .get(FIRST_USER_ID) as Record<string, unknown>;
      const secondCount = raw.prepare('SELECT COUNT(*) AS count FROM history WHERE user_id = ?;')
        .get(SECOND_USER_ID) as Record<string, unknown>;
      assert.equal(Number(firstCount.count), 2_000);
      assert.equal(Number(secondCount.count), 1);
    } finally {
      raw.close();
    }

    database.close();
  });
});

test('schema v9 exige dono em todo item de histórico persistido', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    database.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    database.close();

    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA foreign_keys = ON;');
    try {
      const columns = raw.prepare('PRAGMA table_info(history);').all() as Array<{
        name?: string;
        notnull?: number;
      }>;
      assert.equal(columns.find(column => column.name === 'user_id')?.notnull, 1);
      assert.throws(() => {
        raw.prepare(`
          INSERT INTO history(user_id, track_id, played_at)
          VALUES (NULL, 'a', '2026-08-26T12:00:00.000Z');
        `).run();
      });
    } finally {
      raw.close();
    }
  });
});

test('migration v7 atribui histórico global ao primeiro usuário e preserva ordem e timestamps', async () => {
  await withDatabase(async databasePath => {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');
    prepared.close();

    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z', 'admin');
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'user');
    replaceHistoryWithLegacyV7(databasePath, [
      { id: 4, trackId: 'a', playedAt: '2026-08-20T09:30:00.000Z' },
      { id: 9, trackId: 'b', playedAt: '2026-08-21T09:30:00.000Z' }
    ]);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 9);
    assert.deepEqual(migrated.getHistory(FIRST_USER_ID).map(item => item.track.id), ['b', 'a']);
    assert.deepEqual(migrated.getHistory(SECOND_USER_ID), []);
    migrated.close();

    const raw = new DatabaseSync(databasePath);
    try {
      const rows = raw.prepare(`
        SELECT id, user_id, track_id, played_at
        FROM history
        ORDER BY id ASC;
      `).all() as Array<Record<string, unknown>>;
      assert.deepEqual(rows.map(row => Number(row.id)), [4, 9]);
      assert.deepEqual(rows.map(row => row.user_id), [FIRST_USER_ID, FIRST_USER_ID]);
      assert.deepEqual(rows.map(row => row.played_at), [
        '2026-08-20T09:30:00.000Z',
        '2026-08-21T09:30:00.000Z'
      ]);
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_history_pending;').get() as Record<string, unknown>).count),
        0
      );
    } finally {
      raw.close();
    }
  });
});

test('migration pré-bootstrap mantém histórico fora da tabela ativa e bootstrap o reivindica', async () => {
  await withDatabase(async databasePath => {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.syncTracks([indexedTrack('a'), indexedTrack('b')], '/music', '2026-08-26T12:00:00.000Z');
    prepared.close();

    replaceHistoryWithLegacyV7(databasePath, [
      { id: 3, trackId: 'a', playedAt: '2026-08-20T09:30:00.000Z' },
      { id: 8, trackId: 'b', playedAt: '2026-08-21T09:30:00.000Z' }
    ]);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 9);
    assert.deepEqual(migrated.getHistory(FIRST_USER_ID), []);
    migrated.close();

    const pending = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((pending.prepare('SELECT COUNT(*) AS count FROM history;').get() as Record<string, unknown>).count),
        0
      );
      const rows = pending.prepare(`
        SELECT id, track_id, played_at
        FROM legacy_history_pending
        ORDER BY id ASC;
      `).all() as Array<Record<string, unknown>>;
      assert.deepEqual(rows.map(row => Number(row.id)), [3, 8]);
      assert.deepEqual(rows.map(row => row.track_id), ['a', 'b']);
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
    assert.deepEqual(claimed.getHistory(FIRST_USER_ID).map(item => item.track.id), ['b', 'a']);
    assert.equal(claimed.getStatistics(FIRST_USER_ID, 'all').totalPlays, 2);
    claimed.close();

    const raw = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_history_pending;').get() as Record<string, unknown>).count),
        0
      );
      const rows = raw.prepare(`
        SELECT user_id, track_id, played_at
        FROM history
        ORDER BY id ASC;
      `).all() as Array<Record<string, unknown>>;
      assert.deepEqual(rows.map(row => row.user_id), [FIRST_USER_ID, FIRST_USER_ID]);
      assert.deepEqual(rows.map(row => row.played_at), [
        '2026-08-20T09:30:00.000Z',
        '2026-08-21T09:30:00.000Z'
      ]);
    } finally {
      raw.close();
    }
  });
});

test('bootstrap já inicializado recupera staging de histórico para o primeiro usuário', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    database.syncTracks([indexedTrack('a')], '/music', '2026-08-26T12:00:00.000Z');
    database.close();
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');

    const raw = new DatabaseSync(databasePath);
    try {
      raw.prepare(`
        INSERT INTO legacy_history_pending(id, track_id, played_at)
        VALUES (7, 'a', '2026-08-20T09:30:00.000Z');
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
    assert.deepEqual(recovered.getHistory(FIRST_USER_ID).map(item => item.track.id), ['a']);
    recovered.close();
  });
});
