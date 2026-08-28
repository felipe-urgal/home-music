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

const JPEG_1X1 = Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9
]);

const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
  0x00, 0x00, 0x00
]);

function pngWithDimensions(width: number, height: number) {
  const data = Buffer.from(PNG_1X1);
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

test('inspeção usa bytes reais e valida formatos, estrutura e dimensões', () => {
  const png = inspectCoverOverride(PNG_1X1, 'image/png');
  assert.equal(png.contentType, 'image/png');
  assert.equal(png.width, 1);
  assert.equal(png.height, 1);
  assert.equal(png.sizeBytes, PNG_1X1.byteLength);
  assert.equal(png.version.length, 16);

  const jpeg = inspectCoverOverride(JPEG_1X1, 'image/jpeg');
  assert.equal(jpeg.contentType, 'image/jpeg');
  assert.equal(jpeg.width, 1);
  assert.equal(jpeg.height, 1);

  const webp = inspectCoverOverride(WEBP_1X1, 'image/webp');
  assert.equal(webp.contentType, 'image/webp');
  assert.equal(webp.width, 1);
  assert.equal(webp.height, 1);

  assert.throws(
    () => inspectCoverOverride(PNG_1X1, 'image/jpeg'),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 415
  );
  assert.throws(
    () => inspectCoverOverride(Buffer.from('não é imagem'), 'image/png'),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 415
  );
  assert.throws(
    () => inspectCoverOverride(PNG_1X1.subarray(0, PNG_1X1.length - 12), 'image/png'),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 415
  );
  assert.throws(
    () => inspectCoverOverride(pngWithDimensions(5000, 1), 'image/png'),
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
