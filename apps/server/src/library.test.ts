import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('scanLibrary mantém ID para o mesmo caminho relativo em outra raiz', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-'));

  try {
    const firstRoot = path.join(temp, 'primeira');
    const secondRoot = path.join(temp, 'segunda');
    const relative = path.join('Rock', 'Banda', 'Faixa.mp3');
    await mkdir(path.dirname(path.join(firstRoot, relative)), { recursive: true });
    await mkdir(path.dirname(path.join(secondRoot, relative)), { recursive: true });
    await writeFile(path.join(firstRoot, relative), 'arquivo de teste');
    await writeFile(path.join(secondRoot, relative), 'arquivo de teste');

    const first = await scanLibrary(await resolveLibraryRoot(firstRoot));
    const second = await scanLibrary(await resolveLibraryRoot(secondRoot));
    assert.equal(first.tracks[0].id, second.tracks[0].id);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('scanLibrary ignora subpasta inacessível sem perder o restante da biblioteca', async t => {
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
    t.skip('Permissões POSIX são necessárias para este cenário.');
    return;
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-'));
  const blocked = path.join(temp, 'music', 'Bloqueada');

  try {
    const root = path.join(temp, 'music');
    const allowed = path.join(root, 'Permitida');
    await mkdir(allowed, { recursive: true });
    await mkdir(blocked, { recursive: true });
    await writeFile(path.join(allowed, 'Ok.mp3'), 'arquivo de teste');
    await writeFile(path.join(blocked, 'Privada.mp3'), 'arquivo de teste');
    await chmod(blocked, 0o000);

    const warnings: string[] = [];
    const result = await scanLibrary(
      await resolveLibraryRoot(root),
      [],
      message => warnings.push(message)
    );

    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].title, 'Ok');
    assert.ok(warnings.some(message => message.includes('Bloqueada')));
  } finally {
    await chmod(blocked, 0o700).catch(() => undefined);
    await rm(temp, { recursive: true, force: true });
  }
});
