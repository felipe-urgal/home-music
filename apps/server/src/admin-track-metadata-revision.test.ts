import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminTrackRoutes } from './admin-track-routes.js';

test('mudança de metadata incrementa revisão composta de library e status', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-revision-'));
  const databasePath = path.join(temp, 'home-music.db');
  const musicDir = path.join(temp, 'library');
  await mkdir(musicDir, { recursive: true });

  try {
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
      INSERT INTO tracks(id, file_path, title, artist, album, album_artist)
      VALUES ('track-a', '/library/track-a.mp3', 'Título físico', 'Artista', 'Álbum', 'Artista');
    `);
    db.close();

    const track = {
      id: 'track-a',
      title: 'Título físico',
      artist: 'Artista',
      album: 'Álbum',
      albumArtist: 'Artista',
      folder: 'Pasta',
      folderPath: 'Pasta',
      duration: 100,
      format: 'MP3',
      hasCover: false,
      enabled: true
    };

    const app = Fastify();
    registerAdminTrackRoutes(app, {
      listTracks: () => [track],
      setEnabled: () => track,
      setLocation: () => track
    }, { databasePath, musicDir });
    app.get('/api/library', async () => ({ tracks: [track], scannedAt: '2026-08-28T00:00:00.000Z', scanning: false, revision: 7 }));
    app.get('/api/library/status', async () => ({ scannedAt: '2026-08-28T00:00:00.000Z', scanning: false, revision: 7 }));

    assert.equal((await app.inject({ method: 'GET', url: '/api/library/status' })).json().revision, 7);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tracks/track-a/metadata',
      payload: { title: 'Título corrigido' }
    });
    assert.equal(patched.statusCode, 200);

    const status = await app.inject({ method: 'GET', url: '/api/library/status' });
    assert.equal(status.json().revision, 8);

    const library = await app.inject({ method: 'GET', url: '/api/library' });
    assert.equal(library.json().revision, 8);
    assert.equal(library.json().tracks[0].title, 'Título corrigido');

    await app.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
