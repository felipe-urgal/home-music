import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import Fastify from 'fastify';
import type { AdminTrackMetadataResponse, TrackMetadataOverridePatch } from '@home-music/shared';
import { registerAdminTrackRoutes } from './admin-track-routes.js';

const tempDirs: string[] = [];
const confirmation = ['EXCLUIR', 'PERMANENTEMENTE'].join(' ');

const metadata: AdminTrackMetadataResponse = {
  trackId: 'track-a',
  physical: {
    title: 'Título físico',
    artist: 'Artista físico',
    album: 'Álbum físico',
    albumArtist: 'Artista físico'
  },
  override: {
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    updatedAt: null
  },
  effective: {
    title: 'Título físico',
    artist: 'Artista físico',
    album: 'Álbum físico',
    albumArtist: 'Artista físico'
  }
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function createTrackTable(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT NOT NULL UNIQUE);');
  db.close();
}

test('exclusão permanente exige confirmação exata antes de acessar a lixeira', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-admin-track-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });
  createTrackTable(databasePath);

  const app = Fastify();
  registerAdminTrackRoutes(app, {
    listTracks: () => [],
    setEnabled: () => null,
    getMetadata: () => null,
    patchMetadata: () => null,
    clearMetadata: () => null
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

test('rotas de metadata validam payload, normalizam texto e permitem reset', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-admin-track-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });
  createTrackTable(databasePath);

  let receivedPatch: TrackMetadataOverridePatch | null = null;
  const app = Fastify();
  registerAdminTrackRoutes(app, {
    listTracks: () => [],
    setEnabled: () => null,
    getMetadata: trackId => trackId === 'track-a' ? metadata : null,
    patchMetadata: (trackId, patch) => {
      if (trackId !== 'track-a') return null;
      receivedPatch = patch;
      return {
        ...metadata,
        override: { ...metadata.override, ...patch, updatedAt: '2026-08-28T00:00:00.000Z' },
        effective: { ...metadata.effective, title: patch.title ?? metadata.effective.title }
      };
    },
    clearMetadata: trackId => trackId === 'track-a' ? metadata : null
  }, { databasePath, musicDir });

  const loaded = await app.inject({ method: 'GET', url: '/api/admin/tracks/track-a/metadata' });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json().physical.title, 'Título físico');

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
  assert.deepEqual(receivedPatch, { title: 'Título corrigido', album: null });

  const reset = await app.inject({ method: 'DELETE', url: '/api/admin/tracks/track-a/metadata' });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().override.updatedAt, null);

  const missing = await app.inject({ method: 'GET', url: '/api/admin/tracks/missing/metadata' });
  assert.equal(missing.statusCode, 404);

  await app.close();
});
