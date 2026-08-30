import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { HomeMusicDatabase } from './database.js';

const FIRST_USER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_USER_ID = '22222222-2222-4222-8222-222222222222';

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

function replacePlaybackStateWithLegacyV9(
  databasePath: string,
  state: {
    currentTrackId: string | null;
    position: number;
    volume: number;
    shuffle: boolean;
    repeatMode: 'off' | 'one' | 'all';
    wasPlaying: boolean;
    baseQueueIds: string[];
    queueIds: string[];
    updatedAt: string;
  }
) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    db.exec(`
      DROP TABLE playback_state;
      DROP TABLE legacy_playback_state_pending;
      CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_track_id TEXT,
        position REAL NOT NULL DEFAULT 0,
        volume REAL NOT NULL DEFAULT 1,
        shuffle INTEGER NOT NULL DEFAULT 0,
        repeat_mode TEXT NOT NULL DEFAULT 'off',
        was_playing INTEGER NOT NULL DEFAULT 0,
        base_queue_json TEXT NOT NULL DEFAULT '[]',
        queue_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO playback_state(
        id, current_track_id, position, volume, shuffle, repeat_mode, was_playing,
        base_queue_json, queue_json, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run(
      state.currentTrackId,
      state.position,
      state.volume,
      state.shuffle ? 1 : 0,
      state.repeatMode,
      state.wasPlaying ? 1 : 0,
      JSON.stringify(state.baseQueueIds),
      JSON.stringify(state.queueIds),
      state.updatedAt
    );
    db.exec('PRAGMA user_version = 9;');
  } finally {
    db.close();
  }
}

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-playback-state-ownership-'));
  const databasePath = path.join(directory, 'home-music.db');
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const LEGACY_STATE = {
  currentTrackId: 'track-a',
  position: 42.5,
  volume: 0.65,
  shuffle: true,
  repeatMode: 'all' as const,
  wasPlaying: true,
  baseQueueIds: ['track-a', 'track-b'],
  queueIds: ['track-b', 'track-a'],
  updatedAt: '2026-08-26T12:00:00.000Z'
};

test('estado do player é isolado por usuário e ausência de estado retorna o padrão', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z');

    const secondDefault = database.loadPlaybackState(SECOND_USER_ID);
    assert.equal(secondDefault.currentTrackId, null);
    assert.equal(secondDefault.position, 0);
    assert.equal(secondDefault.volume, 1);
    assert.deepEqual(secondDefault.queueIds, []);

    database.savePlaybackState(FIRST_USER_ID, {
      currentTrackId: 'track-a',
      position: 10,
      volume: 0.4,
      shuffle: true,
      repeatMode: 'all',
      wasPlaying: true,
      baseQueueIds: ['track-a'],
      queueIds: ['track-a']
    });
    database.savePlaybackState(SECOND_USER_ID, {
      currentTrackId: 'track-b',
      position: 20,
      volume: 0.8,
      shuffle: false,
      repeatMode: 'one',
      wasPlaying: false,
      baseQueueIds: ['track-b'],
      queueIds: ['track-b']
    });

    assert.equal(database.loadPlaybackState(FIRST_USER_ID).currentTrackId, 'track-a');
    assert.equal(database.loadPlaybackState(FIRST_USER_ID).position, 10);
    assert.equal(database.loadPlaybackState(SECOND_USER_ID).currentTrackId, 'track-b');
    assert.equal(database.loadPlaybackState(SECOND_USER_ID).position, 20);

    assert.throws(() => database.loadPlaybackState(''), RangeError);
    assert.throws(() => database.savePlaybackState('', {
      currentTrackId: null,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueueIds: [],
      queueIds: []
    }), RangeError);
    assert.throws(() => database.savePlaybackState('usuario-inexistente', {
      currentTrackId: null,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueueIds: [],
      queueIds: []
    }));

    database.close();
  });
});

test('migration v9 atribui estado global ao primeiro usuário criado e preserva todos os campos', async () => {
  await withDatabase(async databasePath => {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.close();
    insertUser(databasePath, SECOND_USER_ID, '2026-08-26T11:00:00.000Z', 'admin');
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'user');
    replacePlaybackStateWithLegacyV9(databasePath, LEGACY_STATE);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 11);
    const first = migrated.loadPlaybackState(FIRST_USER_ID);
    const second = migrated.loadPlaybackState(SECOND_USER_ID);
    assert.equal(first.currentTrackId, LEGACY_STATE.currentTrackId);
    assert.equal(first.position, LEGACY_STATE.position);
    assert.equal(first.volume, LEGACY_STATE.volume);
    assert.equal(first.shuffle, LEGACY_STATE.shuffle);
    assert.equal(first.repeatMode, LEGACY_STATE.repeatMode);
    assert.equal(first.wasPlaying, LEGACY_STATE.wasPlaying);
    assert.deepEqual(first.baseQueueIds, LEGACY_STATE.baseQueueIds);
    assert.deepEqual(first.queueIds, LEGACY_STATE.queueIds);
    assert.equal(first.updatedAt, LEGACY_STATE.updatedAt);
    assert.equal(second.currentTrackId, null);
    migrated.close();

    const raw = new DatabaseSync(databasePath);
    try {
      const row = raw.prepare(`
        SELECT user_id, current_track_id, position, volume, shuffle, repeat_mode,
               was_playing, base_queue_json, queue_json, updated_at
        FROM playback_state;
      `).get() as Record<string, unknown>;
      assert.equal(row.user_id, FIRST_USER_ID);
      assert.equal(row.updated_at, LEGACY_STATE.updatedAt);
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_playback_state_pending;').get() as Record<string, unknown>).count),
        0
      );
    } finally {
      raw.close();
    }
  });
});

test('migration pré-bootstrap guarda estado fora da tabela ativa e bootstrap o reivindica atomicamente', async () => {
  await withDatabase(async databasePath => {
    const prepared = new HomeMusicDatabase(databasePath);
    prepared.close();
    replacePlaybackStateWithLegacyV9(databasePath, LEGACY_STATE);

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 11);
    assert.equal(migrated.loadPlaybackState(FIRST_USER_ID).currentTrackId, null);
    migrated.close();

    const pending = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((pending.prepare('SELECT COUNT(*) AS count FROM playback_state;').get() as Record<string, unknown>).count),
        0
      );
      const row = pending.prepare(`
        SELECT current_track_id, position, volume, shuffle, repeat_mode, was_playing,
               base_queue_json, queue_json, updated_at
        FROM legacy_playback_state_pending
        WHERE id = 1;
      `).get() as Record<string, unknown>;
      assert.equal(row.current_track_id, LEGACY_STATE.currentTrackId);
      assert.equal(row.updated_at, LEGACY_STATE.updatedAt);
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
    const state = claimed.loadPlaybackState(FIRST_USER_ID);
    assert.equal(state.currentTrackId, LEGACY_STATE.currentTrackId);
    assert.equal(state.position, LEGACY_STATE.position);
    assert.deepEqual(state.baseQueueIds, LEGACY_STATE.baseQueueIds);
    assert.deepEqual(state.queueIds, LEGACY_STATE.queueIds);
    assert.equal(state.updatedAt, LEGACY_STATE.updatedAt);
    claimed.close();

    const raw = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((raw.prepare('SELECT COUNT(*) AS count FROM legacy_playback_state_pending;').get() as Record<string, unknown>).count),
        0
      );
    } finally {
      raw.close();
    }
  });
});

test('bootstrap já inicializado recupera staging do player sem sobrescrever estado ativo mais novo', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    database.savePlaybackState(FIRST_USER_ID, {
      currentTrackId: 'estado-atual',
      position: 99,
      volume: 0.9,
      shuffle: false,
      repeatMode: 'one',
      wasPlaying: false,
      baseQueueIds: ['estado-atual'],
      queueIds: ['estado-atual']
    });
    database.close();

    const raw = new DatabaseSync(databasePath);
    try {
      raw.prepare(`
        INSERT INTO legacy_playback_state_pending(
          id, current_track_id, position, volume, shuffle, repeat_mode, was_playing,
          base_queue_json, queue_json, updated_at
        ) VALUES (1, 'estado-legado', 10, 0.5, 1, 'all', 1, '["estado-legado"]', '["estado-legado"]', '2026-08-20T09:00:00.000Z');
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
    assert.equal(recovered.loadPlaybackState(FIRST_USER_ID).currentTrackId, 'estado-atual');
    recovered.close();

    const after = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((after.prepare('SELECT COUNT(*) AS count FROM legacy_playback_state_pending;').get() as Record<string, unknown>).count),
        0
      );
    } finally {
      after.close();
    }
  });
});

test('migration v10 permanece idempotente quando user_version está atrasado e playback_state já tem ownership', async () => {
  await withDatabase(async databasePath => {
    const database = new HomeMusicDatabase(databasePath);
    insertUser(databasePath, FIRST_USER_ID, '2026-08-26T10:00:00.000Z', 'admin');
    database.savePlaybackState(FIRST_USER_ID, {
      currentTrackId: 'track-a',
      position: 12,
      volume: 0.7,
      shuffle: true,
      repeatMode: 'all',
      wasPlaying: true,
      baseQueueIds: ['track-a'],
      queueIds: ['track-a']
    });
    database.close();

    const raw = new DatabaseSync(databasePath);
    try {
      raw.exec('PRAGMA user_version = 9;');
    } finally {
      raw.close();
    }

    const migrated = new HomeMusicDatabase(databasePath);
    assert.equal(migrated.getSchemaVersion(), 11);
    assert.equal(migrated.loadPlaybackState(FIRST_USER_ID).currentTrackId, 'track-a');
    assert.equal(migrated.loadPlaybackState(FIRST_USER_ID).position, 12);
    migrated.close();
  });
});
