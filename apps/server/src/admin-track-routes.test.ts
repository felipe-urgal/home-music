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

test('exclusão permanente exige confirmação exata antes de acessar a lixeira', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-admin-track-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT NOT NULL UNIQUE);');
  db.close();

  const app = Fastify();
  registerAdminTrackRoutes(app, {
    listTracks: () => [],
    setEnabled: () => null
  }, { databasePath, musicDir });

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
