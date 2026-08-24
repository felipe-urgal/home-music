import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  isPathInside,
  parseByteRange,
  resolveLibraryRoot,
  resolveRegularFileInside,
  UnsafeLibraryPathError
} from './security.js';

test('isPathInside não aceita escapes por ..', () => {
  const root = path.join(path.sep, 'music');
  assert.equal(isPathInside(root, path.join(root, 'rock', 'song.mp3')), true);
  assert.equal(isPathInside(root, path.join(path.sep, 'etc', 'passwd')), false);
});

test('resolveRegularFileInside rejeita symlink mesmo quando aponta para arquivo', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-'));
  const root = path.join(temp, 'music');
  const outside = path.join(temp, 'outside.mp3');

  await import('node:fs/promises').then(({ mkdir }) => mkdir(root));
  await writeFile(outside, 'not really audio');
  await symlink(outside, path.join(root, 'linked.mp3'));

  const libraryRoot = await resolveLibraryRoot(root);
  await assert.rejects(
    () => resolveRegularFileInside(libraryRoot, path.join(root, 'linked.mp3')),
    UnsafeLibraryPathError
  );
});

test('parseByteRange suporta ranges normais, abertos e suffix', () => {
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-200', 1000), { start: 800, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-2000', 1000), { start: 0, end: 999 });
});

test('parseByteRange rejeita ranges inválidos e múltiplos', () => {
  assert.equal(parseByteRange('bytes=-', 1000), null);
  assert.equal(parseByteRange('bytes=1000-', 1000), null);
  assert.equal(parseByteRange('bytes=200-100', 1000), null);
  assert.equal(parseByteRange('bytes=0-1,4-5', 1000), null);
});
