import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanLibrary } from './library.js';
import { resolveLibraryRoot } from './security.js';

test('scanLibrary preserva caminho relativo hierárquico e reaproveita arquivos inalterados', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-'));

  try {
    const root = path.join(temp, 'music');
    const queen = path.join(root, 'Rock Internacional', 'Queen');
    await mkdir(queen, { recursive: true });
    await writeFile(path.join(queen, 'Bohemian Rhapsody.mp3'), 'arquivo de teste');

    const libraryRoot = await resolveLibraryRoot(root);
    const first = await scanLibrary(libraryRoot);

    assert.equal(first.tracks.length, 1);
    assert.equal(first.stats.added, 1);
    assert.equal(first.tracks[0].folder, 'Rock Internacional');
    assert.equal(first.tracks[0].folderPath, 'Rock Internacional/Queen');
    assert.equal(first.tracks[0].title, 'Bohemian Rhapsody');

    const second = await scanLibrary(libraryRoot, first.tracks);
    assert.equal(second.stats.unchanged, 1);
    assert.equal(second.stats.added, 0);
    assert.equal(second.stats.updated, 0);
    assert.equal(second.tracks[0].id, first.tracks[0].id);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('scanLibrary informa remoções no scan incremental', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-'));

  try {
    const root = path.join(temp, 'music');
    await mkdir(root, { recursive: true });
    const file = path.join(root, 'Teste.mp3');
    await writeFile(file, 'arquivo de teste');

    const libraryRoot = await resolveLibraryRoot(root);
    const first = await scanLibrary(libraryRoot);
    await rm(file);
    const second = await scanLibrary(libraryRoot, first.tracks);

    assert.equal(second.tracks.length, 0);
    assert.equal(second.stats.removed, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
