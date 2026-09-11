import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';
import Fastify from 'fastify';
import type { AdminTrack } from '@home-music/shared';
import { registerAdminTrackRoutes } from './admin-track-routes.js';

const tempDirs: string[] = [];
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const physicalTrack: AdminTrack = {
  id: 'track-a',
  title: 'Águas de Março',
  artist: 'Elis Regina',
  album: 'Elis & Tom',
  albumArtist: 'Elis Regina & Tom Jobim',
  folder: 'Elis & Tom',
  folderPath: 'Elis & Tom',
  duration: 120,
  format: 'MP3',
  hasCover: false,
  enabled: true
};

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
      album_artist TEXT NOT NULL,
      folder TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      has_cover INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO tracks(
      id, file_path, title, artist, album, album_artist, folder, folder_path, has_cover
    ) VALUES (
      'track-a', '/library/track-a.mp3', 'Águas de Março', 'Elis Regina',
      'Elis & Tom', 'Elis Regina & Tom Jobim', 'Elis & Tom', 'Elis & Tom', 0
    );
  `);
  db.close();
}

function registerTestRoutes(databasePath: string, musicDir: string) {
  const app = Fastify({ bodyLimit: 256 * 1024 });
  registerAdminTrackRoutes(app, {
    listTracks: () => [physicalTrack],
    setEnabled: () => null,
    setLocation: () => null
  }, { databasePath, musicDir });
  app.get('/api/tracks/:id/cover', async (_request, reply) => reply.code(404).send());
  return app;
}

test('capa gerada sobrevive a restart e continua substituível/removível pelo pipeline existente', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'home-music-generated-artwork-routes-'));
  tempDirs.push(root);
  const musicDir = path.join(root, 'library');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(musicDir, { recursive: true });
  createTrackTable(databasePath);

  const firstApp = registerTestRoutes(databasePath, musicDir);
  const generated = await firstApp.inject({
    method: 'POST',
    url: '/api/admin/tracks/track-a/cover/generated'
  });
  assert.equal(generated.statusCode, 200);
  assert.equal(generated.json().physicalHasCover, false);
  assert.equal(generated.json().effectiveHasCover, true);
  assert.equal(generated.json().override.contentType, 'image/png');
  assert.equal(generated.json().override.width, 512);
  assert.equal(generated.json().override.height, 512);
  const generatedVersion = generated.json().override.version as string;

  const publicGenerated = await firstApp.inject({
    method: 'GET',
    url: `/api/tracks/track-a/cover?v=${generatedVersion}`
  });
  assert.equal(publicGenerated.statusCode, 200);
  assert.equal(publicGenerated.headers['content-type'], 'image/png');
  assert.deepEqual(publicGenerated.rawPayload.subarray(0, 8), Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]));

  await firstApp.close();

  const restartedApp = registerTestRoutes(databasePath, musicDir);
  const afterRestart = await restartedApp.inject({
    method: 'GET',
    url: '/api/admin/tracks/track-a/cover'
  });
  assert.equal(afterRestart.statusCode, 200);
  assert.equal(afterRestart.json().effectiveHasCover, true);
  assert.equal(afterRestart.json().override.version, generatedVersion);

  const publicAfterRestart = await restartedApp.inject({
    method: 'GET',
    url: `/api/tracks/track-a/cover?v=${generatedVersion}`
  });
  assert.equal(publicAfterRestart.statusCode, 200);
  assert.deepEqual(publicAfterRestart.rawPayload, publicGenerated.rawPayload);

  const replaced = await restartedApp.inject({
    method: 'PUT',
    url: '/api/admin/tracks/track-a/cover',
    headers: { 'content-type': 'image/png' },
    payload: PNG_1X1
  });
  assert.equal(replaced.statusCode, 200);
  assert.equal(replaced.json().override.width, 1);
  assert.notEqual(replaced.json().override.version, generatedVersion);

  const replacementCover = await restartedApp.inject({
    method: 'GET',
    url: `/api/tracks/track-a/cover?v=${replaced.json().override.version}`
  });
  assert.equal(replacementCover.statusCode, 200);
  assert.deepEqual(replacementCover.rawPayload, PNG_1X1);

  const removed = await restartedApp.inject({
    method: 'DELETE',
    url: '/api/admin/tracks/track-a/cover'
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().effectiveHasCover, false);
  assert.equal(removed.json().override, null);

  const missing = await restartedApp.inject({ method: 'GET', url: '/api/tracks/track-a/cover' });
  assert.equal(missing.statusCode, 404);

  await restartedApp.close();
});
