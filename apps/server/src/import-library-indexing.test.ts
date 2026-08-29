import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HomeMusicDatabase } from './database.js';
import { indexLibraryFile, mergeIndexedTrack, scanLibrary, type IndexedTrack } from './library.js';
import { LibraryMutationLock } from './library-mutation-lock.js';
import { resolveLibraryRoot } from './security.js';

function trackSnapshot(tracks: IndexedTrack[]) {
  return tracks.map(track => ({
    id: track.id,
    filePath: track.filePath,
    title: track.title,
    artist: track.artist,
    album: track.album,
    folderPath: track.folderPath,
    fileSize: track.fileSize,
    mtimeMs: track.mtimeMs
  }));
}

test('indexação de uma importação mantém SQLite e snapshot em memória convergentes', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-index-'));
  const root = path.join(temp, 'music');
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);

  try {
    await mkdir(path.join(root, 'Importados'), { recursive: true });
    await writeFile(path.join(root, 'Existente.mp3'), 'existente');
    const libraryRoot = await resolveLibraryRoot(root);
    let memory = (await scanLibrary(libraryRoot)).tracks;
    database.syncTracks(memory, libraryRoot, '2026-08-29T12:00:00.000Z');

    const promoted = path.join(root, 'Importados', 'Nova.mp3');
    await writeFile(promoted, 'promovida');
    const indexed = await indexLibraryFile(libraryRoot, promoted);
    const next = mergeIndexedTrack(memory, indexed);
    database.syncTracks(next, libraryRoot, '2026-08-29T12:01:00.000Z');
    memory = next;

    assert.deepEqual(trackSnapshot(database.loadTracks()), trackSnapshot(memory));
    assert.equal(memory.length, 2);
    assert.equal(memory.some(track => track.filePath === promoted), true);
    assert.equal(database.getMetadata('libraryRoot'), libraryRoot);
    assert.equal(database.getMetadata('scannedAt'), '2026-08-29T12:01:00.000Z');
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('scan e indexação concorrentes são serializados e não duplicam o arquivo promovido', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-index-race-'));
  const root = path.join(temp, 'music');
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  const lock = new LibraryMutationLock();

  try {
    await mkdir(path.join(root, 'Importados'), { recursive: true });
    await writeFile(path.join(root, 'Base.mp3'), 'base');
    const libraryRoot = await resolveLibraryRoot(root);
    let memory = (await scanLibrary(libraryRoot)).tracks;
    database.syncTracks(memory, libraryRoot, '2026-08-29T12:00:00.000Z');

    const promoted = path.join(root, 'Importados', 'Concorrente.mp3');
    await writeFile(promoted, 'promovida');
    let releaseScan!: () => void;
    const scanGate = new Promise<void>(resolve => {
      releaseScan = resolve;
    });
    const order: string[] = [];

    const scan = lock.run(async () => {
      order.push('scan:start');
      const result = await scanLibrary(libraryRoot, memory);
      await scanGate;
      database.syncTracks(result.tracks, libraryRoot, '2026-08-29T12:01:00.000Z');
      memory = result.tracks;
      order.push('scan:end');
    });
    const incremental = lock.run(async () => {
      order.push('index:start');
      const existing = memory.find(track => track.filePath === promoted);
      const indexed = await indexLibraryFile(libraryRoot, promoted, existing?.id);
      const next = mergeIndexedTrack(memory, indexed);
      database.syncTracks(next, libraryRoot, '2026-08-29T12:02:00.000Z');
      memory = next;
      order.push('index:end');
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['scan:start']);
    releaseScan();
    await Promise.all([scan, incremental]);

    assert.deepEqual(order, ['scan:start', 'scan:end', 'index:start', 'index:end']);
    assert.equal(memory.filter(track => track.filePath === promoted).length, 1);
    assert.deepEqual(trackSnapshot(database.loadTracks()), trackSnapshot(memory));
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
});
