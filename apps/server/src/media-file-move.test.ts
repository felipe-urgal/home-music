import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  MediaFileMoveOperationError,
  MediaFileMoveStore,
  normalizeAdminTrackFileName,
  normalizeAdminTrackFolderPath
} from './media-file-move.js';
import { UnsafeLibraryPathError } from './security.js';

function seed(databasePath: string, filePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      folder TEXT NOT NULL,
      folder_path TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO tracks(id, file_path, folder, folder_path)
    VALUES ('track-a', ?, 'Origem', 'Origem');
  `).run(filePath);
  db.close();
}

function row(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    return db.prepare(`
      SELECT id, file_path, folder, folder_path
      FROM tracks WHERE id = 'track-a';
    `).get() as Record<string, unknown>;
  } finally {
    db.close();
  }
}
test('normalização rejeita traversal, caminhos ocultos e troca de extensão', () => {
  assert.deepEqual(normalizeAdminTrackFolderPath('Artista/Álbum'), ['Artista', 'Álbum']);
  assert.deepEqual(normalizeAdminTrackFolderPath(''), []);

  for (const invalid of ['../fora', 'Artista/../fora', '/absoluto', 'Artista\\Album', '.oculto']) {
    assert.throws(
      () => normalizeAdminTrackFolderPath(invalid),
      (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 400
    );
  }

  assert.equal(normalizeAdminTrackFileName('Nova faixa.MP3', 'faixa.mp3'), 'Nova faixa.MP3');
  assert.throws(
    () => normalizeAdminTrackFileName('faixa.flac', 'faixa.mp3'),
    (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 400
  );
  assert.throws(
    () => normalizeAdminTrackFileName('../faixa.mp3', 'faixa.mp3'),
    (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 400
  );
});

test('move arquivo, cria pasta segura, preserva id e atualiza SQLite', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-file-move-'));
  const library = path.join(temp, 'music');
  const sourceDir = path.join(library, 'Origem');
  const source = path.join(sourceDir, 'faixa.mp3');
  const databasePath = path.join(temp, 'home-music.db');

  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(source, 'audio-fixture');
    seed(databasePath, source);
    const store = new MediaFileMoveStore(databasePath, library);

    const result = await store.move(
      'track-a',
      { folderPath: 'Artista/Álbum', fileName: 'Nova faixa.mp3' },
      location => ({ id: 'track-a', ...location })
    );

    assert.equal(result.moved, true);
    assert.equal(result.track.id, 'track-a');
    assert.equal(result.location.relativePath, 'Artista/Álbum/Nova faixa.mp3');
    assert.equal(result.location.folderPath, 'Artista/Álbum');
    assert.equal(await readFile(path.join(library, 'Artista', 'Álbum', 'Nova faixa.mp3'), 'utf8'), 'audio-fixture');

    const stored = row(databasePath);
    assert.equal(stored.id, 'track-a');
    assert.equal(stored.folder, 'Artista');
    assert.equal(stored.folder_path, 'Artista/Álbum');
    assert.equal(stored.file_path, path.join(library, 'Artista', 'Álbum', 'Nova faixa.mp3'));

    const location = await store.getLocation('track-a');
    assert.equal(location?.relativePath, 'Artista/Álbum/Nova faixa.mp3');
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('colisão não altera filesystem nem SQLite', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-file-move-'));
  const library = path.join(temp, 'music');
  const sourceDir = path.join(library, 'Origem');
  const destinationDir = path.join(library, 'Destino');
  const source = path.join(sourceDir, 'faixa.mp3');
  const destination = path.join(destinationDir, 'faixa.mp3');
  const databasePath = path.join(temp, 'home-music.db');

  try {
    await mkdir(sourceDir, { recursive: true });
    await mkdir(destinationDir, { recursive: true });
    await writeFile(source, 'origem');
    await writeFile(destination, 'destino');
    seed(databasePath, source);
    const store = new MediaFileMoveStore(databasePath, library);

    await assert.rejects(
      store.move('track-a', { folderPath: 'Destino', fileName: 'faixa.mp3' }, () => ({ ok: true })),
      (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 409
    );
    assert.equal(await readFile(source, 'utf8'), 'origem');
    assert.equal(await readFile(destination, 'utf8'), 'destino');
    assert.equal(row(databasePath).file_path, source);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('callback de índice falhando aciona rollback de SQLite e filesystem', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-file-move-'));
  const library = path.join(temp, 'music');
  const sourceDir = path.join(library, 'Origem');
  const source = path.join(sourceDir, 'faixa.mp3');
  const databasePath = path.join(temp, 'home-music.db');

  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(source, 'audio-fixture');
    seed(databasePath, source);
    const store = new MediaFileMoveStore(databasePath, library);

    await assert.rejects(
      store.move('track-a', { folderPath: 'Novo', fileName: 'faixa.mp3' }, () => null),
      (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 409
    );

    assert.equal(await readFile(source, 'utf8'), 'audio-fixture');
    assert.equal(row(databasePath).file_path, source);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('symlink em pasta de destino é bloqueado antes do rename', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-file-move-'));
  const library = path.join(temp, 'music');
  const outside = path.join(temp, 'outside');
  const sourceDir = path.join(library, 'Origem');
  const source = path.join(sourceDir, 'faixa.mp3');
  const databasePath = path.join(temp, 'home-music.db');

  try {
    await mkdir(sourceDir, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(source, 'audio-fixture');
    await symlink(outside, path.join(library, 'Escape'));
    seed(databasePath, source);
    const store = new MediaFileMoveStore(databasePath, library);

    await assert.rejects(
      store.move('track-a', { folderPath: 'Escape', fileName: 'faixa.mp3' }, () => ({ ok: true })),
      (error: unknown) => error instanceof UnsafeLibraryPathError
    );
    assert.equal(await readFile(source, 'utf8'), 'audio-fixture');
    assert.equal(row(databasePath).file_path, source);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
