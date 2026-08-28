import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import Fastify from 'fastify';
import { registerAdminTrackRoutes } from './admin-track-routes.js';

const tempDirs: string[] = [];
const confirmation = ['EXCLUIR', 'PERMANENTEMENTE'].join(' ');

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function createTrackTable(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      album_artist TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO tracks(id, file_path, title, artist, album, album_artist)
    VALUES ('track-a', '/library/track-a.mp3', 'Título físico', 'Artista físico', 'Álbum físico', 'Artista físico');
  `).run();
  db.close();
}

function service() {
  return {
    listTracks: () => [],
    setEnabled: () => null
  };
}

test('exclusão permanente exige confirmação exata antes de acessar a lixeira', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-admin-track-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });
  createTrackTable(databasePath);

  const app = Fastify();
  registerAdminTrackRoutes(app, service(), { databasePath, musicDir });

  const missing = await app.inject({ method: 'DELETE', url: '/api/admin/quarantine/missing', payload: {} });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.json().error, /confirmação explícita/i);

  const wrong = await app.inject({
    method: 'DELETE',
    url: '/api/admin/quarantine/missing',
    payload: { confirmation: 'confirmo' }
  });
  assert.equal(wrong.statusCode, 400);

  const confirmed = await app.inject({
    method: 'DELETE',
    url: '/api/admin/quarantine/missing',
    payload: { confirmation }
  });
  assert.equal(confirmed.statusCode, 404);

  await app.close();
});

test('rotas de metadata validam payload, normalizam texto e permitem reset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-admin-track-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });
  createTrackTable(databasePath);

  const app = Fastify();
  registerAdminTrackRoutes(app, service(), { databasePath, musicDir });

  const loaded = await app.inject({ method: 'GET', url: '/api/admin/tracks/track-a/metadata' });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json().physical.title, 'Título físico');
  assert.equal(loaded.json().override.updatedAt, null);

  const invalidEmpty = await app.inject({
    method: 'PATCH',
    url: '/api/admin/tracks/track-a/metadata',
    payload: { title: '   ' }
  });
  assert.equal(invalidEmpty.statusCode, 400);
  assert.match(invalidEmpty.json().error, /não pode ficar vazio/i);

  const invalidField = await app.inject({
    method: 'PATCH',
    url: '/api/admin/tracks/track-a/metadata',
    payload: { filePath: '/tmp/injetado.mp3' }
  });
  assert.equal(invalidField.statusCode, 400);
  assert.match(invalidField.json().error, /não suportado/i);

  const updated = await app.inject({
    method: 'PATCH',
    url: '/api/admin/tracks/track-a/metadata',
    payload: { title: '  Título corrigido  ', album: null }
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().override.title, 'Título corrigido');
  assert.equal(updated.json().effective.title, 'Título corrigido');
  assert.equal(updated.json().physical.title, 'Título físico');

  const raw = new DatabaseSync(databasePath);
  const physical = raw.prepare('SELECT title FROM tracks WHERE id = ?;').get('track-a') as { title: string };
  assert.equal(physical.title, 'Título físico');
  raw.close();

  const reset = await app.inject({ method: 'DELETE', url: '/api/admin/tracks/track-a/metadata' });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().override.updatedAt, null);
  assert.equal(reset.json().effective.title, 'Título físico');

  const missing = await app.inject({ method: 'GET', url: '/api/admin/tracks/missing/metadata' });
  assert.equal(missing.statusCode, 404);

  await app.close();
});

test('camada efetiva altera /api/library sem mutar o payload físico original', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-admin-track-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });
  createTrackTable(databasePath);

  const app = Fastify();
  registerAdminTrackRoutes(app, service(), { databasePath, musicDir });
  const physicalTrack = {
    id: 'track-a',
    title: 'Título físico',
    artist: 'Artista físico',
    album: 'Álbum físico',
    albumArtist: 'Artista físico',
    folder: 'Pasta',
    folderPath: 'Pasta',
    duration: 120,
    format: 'MP3',
    hasCover: false
  };
  app.get('/api/library', async () => ({ tracks: [physicalTrack], scannedAt: '2026-08-28T00:00:00.000Z', scanning: false }));

  const edited = await app.inject({
    method: 'PATCH',
    url: '/api/admin/tracks/track-a/metadata',
    payload: { title: 'Título efetivo' }
  });
  assert.equal(edited.statusCode, 200);

  const library = await app.inject({ method: 'GET', url: '/api/library' });
  assert.equal(library.statusCode, 200);
  assert.equal(library.json().tracks[0].title, 'Título efetivo');
  assert.equal(physicalTrack.title, 'Título físico');

  await app.close();
});
