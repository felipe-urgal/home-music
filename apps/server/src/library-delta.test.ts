import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanLibrary } from './library.js';
import { resolveLibraryRoot } from './security.js';

test('scanLibrary transporta delta explícito de adicionadas, atualizadas e removidas', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-delta-'));

  try {
    const root = path.join(temp, 'music');
    await mkdir(root, { recursive: true });
    const fileA = path.join(root, 'A.mp3');
    const fileB = path.join(root, 'B.mp3');
    const fileC = path.join(root, 'C.mp3');
    await writeFile(fileA, 'a');
    await writeFile(fileB, 'b');

    const libraryRoot = await resolveLibraryRoot(root);
    const initial = await scanLibrary(libraryRoot);
    assert.equal(initial.delta.added.length, 2);
    assert.deepEqual(initial.delta.updated, []);
    assert.deepEqual(initial.delta.removedIds, []);

    const unchanged = await scanLibrary(libraryRoot, initial.tracks);
    assert.deepEqual(unchanged.delta, { added: [], updated: [], removedIds: [] });

    const previousA = unchanged.tracks.find(track => track.filePath === fileA);
    const previousB = unchanged.tracks.find(track => track.filePath === fileB);
    assert.ok(previousA);
    assert.ok(previousB);

    await writeFile(fileA, 'arquivo a alterado com tamanho diferente');
    await rm(fileB);
    await writeFile(fileC, 'c');

    const changed = await scanLibrary(libraryRoot, unchanged.tracks);
    assert.equal(changed.delta.added.length, 1);
    assert.equal(changed.delta.added[0].filePath, fileC);
    assert.equal(changed.delta.updated.length, 1);
    assert.equal(changed.delta.updated[0].id, previousA.id);
    assert.deepEqual(changed.delta.removedIds, [previousB.id]);
    assert.deepEqual(changed.stats, { added: 1, updated: 1, removed: 1, unchanged: 0 });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
