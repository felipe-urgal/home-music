import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { HomeMusicDatabase } from './database.js';
import { LibraryService } from './library-service.js';
import { TrackAvailabilityStore } from './track-availability-store.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';

async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hm-scanner-lifecycle-'));
  const musicDir = path.join(temp, 'music');
  const dbPath = path.join(temp, 'library.sqlite');
  await mkdir(musicDir);
  const connections: Array<() => void> = [];
  const createService = () => {
    const database = new HomeMusicDatabase(dbPath);
    const trackAvailability = new TrackAvailabilityStore(dbPath);
    const operationHistory = new AdminOperationHistoryStore(dbPath);
    connections.push(() => {
      operationHistory.close();
      trackAvailability.close();
      database.close();
    });
    return {
      database,
      service: new LibraryService({
        musicDir, autoRescanIntervalSeconds: 0, database,
        trackAvailability, operationHistory,
        logger: { warn() {}, info() {}, error() {} }
      })
    };
  };
  return {
    musicDir, dbPath, createService,
    async close() {
      for (const close of connections.reverse()) close();
      await rm(temp, { recursive: true, force: true });
    }
  };
}

test('restart hidrata snapshot rapidamente e reconcilia adições sem auto-rescan configurado', async () => {
  const context = await fixture();
  try {
    await writeFile(path.join(context.musicDir, 'A.mp3'), 'audio A');
    const first = context.createService();
    await first.service.initialize();
    assert.equal(first.service.allTracks.length, 1);
    const initialId = first.service.allTracks[0].id;

    await writeFile(path.join(context.musicDir, 'B.mp3'), 'audio B');
    const restarted = context.createService();
    await restarted.service.initialize();
    assert.equal(restarted.service.ready, true);
    assert.equal(restarted.service.needsStartupReconciliation, true);
    assert.equal(restarted.service.status().freshness, 'stale');
    assert.equal(restarted.service.allTracks.length, 1);
    assert.equal(restarted.service.status().revision, 0);

    const changed = await restarted.service.rescan('automatic');
    assert.equal(changed.added, 1);
    assert.equal(restarted.service.allTracks.length, 2);
    assert.equal(restarted.service.status().freshness, 'fresh');
    assert.equal(restarted.service.status().revision, 1);
    assert.ok(restarted.service.getTrack(initialId));

    const noChange = await restarted.service.rescan('automatic');
    assert.deepEqual([noChange.added, noChange.updated, noChange.removed], [0, 0, 0]);
    assert.equal(restarted.service.status().revision, 1);
    assert.deepEqual(
      restarted.database.loadTracks().map(track => track.id).sort(),
      restarted.service.allTracks.map(track => track.id).sort()
    );
  } finally {
    await context.close();
  }
});

test('restart reconcilia remoções e snapshots iguais mantêm revision estável', async () => {
  const context = await fixture();
  try {
    const original = path.join(context.musicDir, 'A.mp3');
    await writeFile(original, 'audio A');
    const first = context.createService();
    await first.service.initialize();
    const initial = context.createService();
    await initial.service.initialize();
    const unchanged = await initial.service.rescan();
    assert.equal(unchanged.removed, 0);
    assert.equal(initial.service.status().revision, 0);

    await rm(original);
    const restarted = context.createService();
    await restarted.service.initialize();
    assert.equal(restarted.service.allTracks.length, 1);
    const result = await restarted.service.rescan();
    assert.equal(result.removed, 1);
    assert.equal(restarted.service.allTracks.length, 0);
    assert.equal(restarted.database.loadTracks().length, 0);
  } finally {
    await context.close();
  }
});

test('root indisponível preserva último snapshot e expõe erro sanitizado até recuperar', async () => {
  const context = await fixture();
  try {
    await writeFile(path.join(context.musicDir, 'A.mp3'), 'audio A');
    const first = context.createService();
    await first.service.initialize();
    const trackId = first.service.allTracks[0].id;

    const missingRoot = context.musicDir + '-offline';
    await rename(context.musicDir, missingRoot);
    const restarted = context.createService();
    await restarted.service.initialize();
    assert.equal(restarted.service.ready, true);
    assert.equal(restarted.service.status().freshness, 'degraded');
    assert.equal(restarted.service.allTracks[0].id, trackId);
    assert.equal(restarted.service.needsStartupReconciliation, true);
    await assert.rejects(() => restarted.service.rescan());
    assert.equal(restarted.service.status().ready, true);
    assert.equal(restarted.service.status().freshness, 'degraded');
    assert.ok(restarted.service.status().lastError);
    assert.ok(!restarted.service.status().lastError?.includes(context.musicDir));
    assert.equal(restarted.database.loadTracks().length, 1);

    await rename(missingRoot, context.musicDir);
    const result = await restarted.service.rescan();
    assert.deepEqual([result.added, result.updated, result.removed], [0, 0, 0]);
    assert.equal(restarted.service.status().freshness, 'fresh');
    assert.equal(restarted.service.status().lastError, null);
    assert.equal(restarted.service.status().revision, 0);
  } finally {
    await context.close();
  }
});

test('erro de persistência no rescan não publica delta nem elimina last-known-good', async () => {
  const context = await fixture();
  try {
    await writeFile(path.join(context.musicDir, 'A.mp3'), 'audio A');
    const { service, database } = context.createService();
    await service.initialize();
    const trackId = service.allTracks[0].id;
    await writeFile(path.join(context.musicDir, 'B.mp3'), 'audio B');
    const original = database.applyTrackDelta.bind(database);
    database.applyTrackDelta = () => { throw new Error('falha sintética de SQLite'); };
    try {
      await assert.rejects(service.rescan(), /falha sintética/);
      assert.equal(service.ready, true);
      assert.equal(service.status().freshness, 'degraded');
      assert.equal(service.getTrack(trackId)?.id, trackId);
      assert.equal(service.allTracks.length, 1);
      assert.equal(database.loadTracks().length, 1);
      assert.equal(service.status().revision, 1);
    } finally {
      database.applyTrackDelta = original;
    }
    const retry = await service.rescan();
    assert.equal(retry.added, 1);
    assert.equal(service.status().freshness, 'fresh');
    assert.equal(database.loadTracks().length, 2);
  } finally {
    await context.close();
  }
});

test('import incremental e rescan concorrentes compartilham identidade e não duplicam tracks', async () => {
  const context = await fixture();
  try {
    const { service, database } = context.createService();
    await service.initialize();
    const file = path.join(context.musicDir, 'Importada.mp3');
    await writeFile(file, 'audio de teste');
    const [scan, imported] = await Promise.all([
      service.rescan('manual'),
      service.updateForPromotedImport({
        absolutePath: file, relativePath: 'Importada.mp3', size: 14, sha256: 'a'.repeat(64)
      }, 'job-lifecycle')
    ]);
    assert.ok(scan);
    assert.ok(imported);
    assert.equal(service.allTracks.length, 1);
    assert.equal(database.loadTracks().length, 1);
    assert.equal(service.status().mutationQueue.active, 0);
  } finally {
    await context.close();
  }
});

test('rename externo altera a identidade baseada no caminho; alteração pela UI mantém ID', async () => {
  const context = await fixture();
  try {
    const oldPath = path.join(context.musicDir, 'Original.mp3');
    const newPath = path.join(context.musicDir, 'Renomeada.mp3');
    await writeFile(oldPath, 'audio');
    const { service, database } = context.createService();
    await service.initialize();
    const oldId = service.allTracks[0].id;
    await rename(oldPath, newPath);
    const result = await service.rescan();
    assert.equal(result.added, 1);
    assert.equal(result.removed, 1);
    assert.notEqual(service.allTracks[0].id, oldId);
    assert.equal(database.loadTracks().length, 1);

    service.beginShutdown();
    await service.waitForIdle();
    await assert.rejects(service.rescan(), /encerrando/);
  } finally {
    await context.close();
  }
});


test('rename externo remove vínculos pessoais dependentes do ID original conforme FKs SQLite', async () => {
  const context = await fixture();
  try {
    const oldPath = path.join(context.musicDir, 'Original.mp3');
    await writeFile(oldPath, 'audio');
    const { service, database } = context.createService();
    await service.initialize();
    const oldId = service.allTracks[0].id;
    const db = new DatabaseSync(context.dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    try {
      const date = new Date().toISOString();
      db.prepare(`INSERT INTO users (id, username, username_normalized, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run('owner-1', 'scanner_user', 'scanner_user', 'synthetic-hash', 'user', date, date);
      db.prepare(`INSERT INTO playlists (id, name, created_at, updated_at, source, owner_user_id)
        VALUES (?, ?, ?, ?, ?, ?)`).run('playlist-1', 'Teste', date, date, 'manual', 'owner-1');
      db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run('playlist-1', oldId, 0);
      db.prepare('INSERT INTO favorites (user_id, track_id, created_at) VALUES (?, ?, ?)').run('owner-1', oldId, date);
      db.prepare('INSERT INTO history (user_id, track_id, played_at) VALUES (?, ?, ?)').run('owner-1', oldId, date);

      for (const table of ['playlist_tracks', 'favorites', 'history']) {
        const count = db.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE track_id = ?`).get(oldId) as { value: number };
        assert.equal(count.value, 1, table);
      }

      await rename(oldPath, path.join(context.musicDir, 'Renomeada.mp3'));
      const result = await service.rescan();
      assert.deepEqual([result.added, result.removed], [1, 1]);
      assert.notEqual(service.allTracks[0].id, oldId);
      for (const table of ['playlist_tracks', 'favorites', 'history']) {
        const count = db.prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE track_id = ?`).get(oldId) as { value: number };
        assert.equal(count.value, 0, `${table} sofre cascade quando o arquivo é renomeado externamente`);
      }
      assert.equal((db.prepare('SELECT COUNT(*) AS value FROM playlists').get() as { value: number }).value, 1);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(database.loadTracks().length, 1);
    } finally {
      db.close();
    }
  } finally {
    await context.close();
  }
});

test('falha na indexação incremental aciona fallback canônico de rescan sem duplicar dados', async () => {
  const context = await fixture();
  try {
    const { service, database } = context.createService();
    await service.initialize();
    await writeFile(path.join(context.musicDir, 'Track.mp3'), 'track new');
    const indexed = await service.updateForPromotedImport({
      absolutePath: path.join(context.musicDir, 'moved-externally.mp3'),
      relativePath: 'moved-externally.mp3', size: 12, sha256: 'a'.repeat(64)
    }, 'job-fallback');
    assert.equal(indexed, null, 'a promoção alegada não foi encontrada');
    assert.equal(service.allTracks.length, 1, 'fallback indexa apenas o arquivo real');
    assert.equal(service.allTracks[0].filePath, path.join(context.musicDir, 'Track.mp3'));
    assert.equal(database.loadTracks().length, 1);
    assert.equal(service.status().freshness, 'fresh');
    assert.deepEqual(database.loadTracks().map(t => t.id), service.allTracks.map(t => t.id));
  } finally {
    await context.close();
  }
});
