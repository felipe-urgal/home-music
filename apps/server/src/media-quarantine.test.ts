import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import type { Track } from '@home-music/shared';
import { scanLibrary, type IndexedTrack } from './library.js';
import { MediaQuarantineOperationError, MediaQuarantineStore } from './media-quarantine.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-quarantine-'));
  tempDirs.push(root);
  const libraryRoot = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  const sourcePath = path.join(libraryRoot, 'Artist', 'Track.wav');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, Buffer.from('audio-fixture'));

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE
    );
  `);
  db.prepare('INSERT INTO tracks(id, file_path) VALUES (?, ?);').run('track-1', sourcePath);
  db.close();

  const track: Track = {
    id: 'track-1',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    albumArtist: 'Artist',
    folder: 'Artist',
    folderPath: 'Artist',
    duration: 10,
    format: 'WAV',
    hasCover: false
  };
  const indexed: IndexedTrack = {
    ...track,
    filePath: sourcePath,
    mimeType: 'audio/wav',
    fileSize: 13,
    mtimeMs: 1
  };
  return { root, libraryRoot, databasePath, sourcePath, track, indexed };
}

test('quarentena preserva o registro no scan e restaura o caminho original', async () => {
  const { libraryRoot, databasePath, sourcePath, track, indexed } = await fixture();
  const store = new MediaQuarantineStore(databasePath, libraryRoot);

  await store.quarantine(track.id, track, true);
  await assert.rejects(access(sourcePath));
  assert.equal(store.listItems().length, 1);

  const scanned = await scanLibrary(libraryRoot, [indexed]);
  assert.equal(scanned.tracks.length, 1);
  assert.equal(scanned.tracks[0]?.id, track.id);
  assert.equal(scanned.stats.unchanged, 1);
  assert.equal(scanned.stats.removed, 0);

  let restoredEnabled: boolean | null = null;
  await store.restore(track.id, enabled => { restoredEnabled = enabled; }, () => undefined);
  assert.equal(restoredEnabled, true);
  assert.equal(store.listItems().length, 0);
  assert.equal((await readFile(sourcePath)).toString(), 'audio-fixture');
  store.close();
});

test('falha parcial de restauração mantém arquivo e registro na lixeira', async () => {
  const { libraryRoot, databasePath, sourcePath, track } = await fixture();
  const store = new MediaQuarantineStore(databasePath, libraryRoot);
  await store.quarantine(track.id, track, false);

  await writeFile(sourcePath, Buffer.from('collision'));
  await assert.rejects(
    store.restore(track.id, () => undefined, () => undefined),
    (error: unknown) => error instanceof MediaQuarantineOperationError && error.statusCode === 409
  );
  const pending = store.listItems();
  assert.equal(pending.length, 1);
  assert.match(pending[0]?.lastError ?? '', /destino/i);
  assert.equal((await readFile(sourcePath)).toString(), 'collision');

  await unlink(sourcePath);
  await store.restore(track.id, () => undefined, () => undefined);
  assert.equal((await readFile(sourcePath)).toString(), 'audio-fixture');
  store.close();
});

test('restauração rejeita path traversal persistido', async () => {
  const { root, libraryRoot, databasePath, track } = await fixture();
  const initial = new MediaQuarantineStore(databasePath, libraryRoot);
  initial.close();

  const trashDir = path.join(libraryRoot, '.home-music-trash', 'files');
  await mkdir(trashDir, { recursive: true });
  const trashPath = path.join(trashDir, `${track.id}.wav`);
  await writeFile(trashPath, Buffer.from('quarantined'));

  const db = new DatabaseSync(databasePath);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO media_quarantine(
      track_id, library_root, original_relative_path, quarantine_relative_path,
      track_json, previous_enabled, state, quarantined_at, updated_at, last_error
    ) VALUES (?, ?, ?, ?, ?, 1, 'quarantined', ?, ?, NULL);
  `).run(
    track.id,
    libraryRoot,
    '../outside.wav',
    `.home-music-trash/files/${track.id}.wav`,
    JSON.stringify(track),
    now,
    now
  );
  db.close();

  const store = new MediaQuarantineStore(databasePath, libraryRoot);
  await assert.rejects(store.restore(track.id, () => undefined, () => undefined));
  await assert.rejects(access(path.join(root, 'outside.wav')));
  assert.equal((await readFile(trashPath)).toString(), 'quarantined');
  store.close();
});

test('exclusão permanente remove o arquivo e deixa o próximo scan finalizar o cleanup', async () => {
  const { libraryRoot, databasePath, sourcePath, track, indexed } = await fixture();
  const store = new MediaQuarantineStore(databasePath, libraryRoot);
  await store.quarantine(track.id, track, true);
  await store.deletePermanently(track.id);

  assert.equal(store.listItems().length, 0);
  assert.equal(store.hasHidden(track.id), true);
  await assert.rejects(access(sourcePath));

  const scanned = await scanLibrary(libraryRoot, [indexed]);
  assert.equal(scanned.tracks.length, 0);
  assert.equal(scanned.stats.removed, 1);
  store.close();
});
