import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getLibraryIntegrityStatus, resetLibraryIntegrityStatusForTests } from './library-integrity.js';
import { scanLibrary } from './library.js';
import { resolveLibraryRoot } from './security.js';

test('scan registra arquivo fora do índice e limpa a divergência no scan seguinte', async () => {
  resetLibraryIntegrityStatusForTests();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-integrity-scan-'));

  try {
    const root = path.join(temp, 'music');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'Nova.mp3'), 'arquivo de teste');
    const libraryRoot = await resolveLibraryRoot(root);

    const first = await scanLibrary(libraryRoot);
    const firstStatus = getLibraryIntegrityStatus();
    assert.equal(
      firstStatus.issues.some(issue => issue.kind === 'unindexed-file' && issue.relativePath === 'Nova.mp3'),
      true
    );

    await scanLibrary(libraryRoot, first.tracks);
    const secondStatus = getLibraryIntegrityStatus();
    assert.equal(secondStatus.issues.some(issue => issue.kind === 'unindexed-file'), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
    resetLibraryIntegrityStatusForTests();
  }
});

test('scan registra caminho ausente sem confundir a lixeira com órfão', async () => {
  resetLibraryIntegrityStatusForTests();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-integrity-missing-'));

  try {
    const root = path.join(temp, 'music');
    await mkdir(root, { recursive: true });
    const file = path.join(root, 'Ausente.mp3');
    await writeFile(file, 'arquivo de teste');
    const libraryRoot = await resolveLibraryRoot(root);

    const first = await scanLibrary(libraryRoot);
    await rm(file);
    const second = await scanLibrary(libraryRoot, first.tracks);
    const status = getLibraryIntegrityStatus();

    assert.equal(second.stats.removed, 1);
    assert.equal(
      status.issues.some(issue =>
        issue.kind === 'missing-file' &&
        issue.trackId === first.tracks[0].id &&
        issue.relativePath === 'Ausente.mp3'
      ),
      true
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
    resetLibraryIntegrityStatusForTests();
  }
});
