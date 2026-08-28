import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  CoverOverrideValidationError,
  inspectCoverOverride,
  TrackCoverOverrideStore
} from './track-cover-overrides.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function pngHeader(width: number, height: number) {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function seedTrack(databasePath: string, hasCover = false) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        has_cover INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.prepare('INSERT INTO tracks(id, has_cover) VALUES (?, ?);').run('track-a', hasCover ? 1 : 0);
  } finally {
    db.close();
  }
}

test('inspeção usa bytes reais e valida formato e dimensões', () => {
  const inspected = inspectCoverOverride(PNG_1X1, 'image/png');
  assert.equal(inspected.contentType, 'image/png');
  assert.equal(inspected.width, 1);
  assert.equal(inspected.height, 1);
  assert.equal(inspected.sizeBytes, PNG_1X1.byteLength);
  assert.equal(inspected.version.length, 16);

  assert.throws(
    () => inspectCoverOverride(PNG_1X1, 'image/jpeg'),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 415
  );
  assert.throws(
    () => inspectCoverOverride(Buffer.from('não é imagem'), 'image/png'),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 415
  );
  assert.throws(
    () => inspectCoverOverride(pngHeader(5000, 1), 'image/png'),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 413
  );
});

test('override persiste, não altera has_cover físico e pode ser restaurado', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-cover-overrides-'));
  const databasePath = path.join(temp, 'home-music.db');

  try {
    seedTrack(databasePath, false);
    const first = new TrackCoverOverrideStore(databasePath);
    const saved = first.save('track-a', PNG_1X1, 'image/png');
    assert.ok(saved?.override);
    assert.equal(saved.physicalHasCover, false);
    assert.equal(saved.effectiveHasCover, true);
    assert.equal(first.resolveTrack({
      id: 'track-a', title: 'A', artist: 'B', album: 'C', albumArtist: 'B',
      folder: 'D', folderPath: 'D', duration: 1, format: 'MP3', hasCover: false
    }).hasCover, true);
    const version = saved.override.version;
    first.close();

    const second = new TrackCoverOverrideStore(databasePath);
    assert.equal(second.getStatus('track-a')?.override?.version, version);
    assert.deepEqual(second.read('track-a')?.data, PNG_1X1);

    const raw = new DatabaseSync(databasePath);
    const physical = raw.prepare('SELECT has_cover FROM tracks WHERE id = ?;').get('track-a') as { has_cover: number };
    assert.equal(physical.has_cover, 0);
    raw.close();

    const restored = second.clear('track-a');
    assert.equal(restored?.physicalHasCover, false);
    assert.equal(restored?.effectiveHasCover, false);
    assert.equal(restored?.override, null);
    second.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('falha de validação não substitui override válido e FK limpa junto com a faixa', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-cover-overrides-'));
  const databasePath = path.join(temp, 'home-music.db');

  try {
    seedTrack(databasePath, true);
    const store = new TrackCoverOverrideStore(databasePath);
    const saved = store.save('track-a', PNG_1X1, 'image/png');
    const version = saved?.override?.version;

    assert.throws(() => store.save('track-a', Buffer.from('inválido'), 'image/png'));
    assert.equal(store.getStatus('track-a')?.override?.version, version);

    const raw = new DatabaseSync(databasePath);
    raw.exec('PRAGMA foreign_keys = ON;');
    raw.prepare('DELETE FROM tracks WHERE id = ?;').run('track-a');
    raw.close();

    store.refresh();
    assert.equal(store.getStatus('track-a'), null);
    assert.equal(store.read('track-a'), null);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
