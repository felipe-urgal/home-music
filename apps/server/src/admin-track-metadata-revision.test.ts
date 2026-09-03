import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminTrackRoutes } from './admin-track-routes.js';
import { registerLibraryRoutes } from './library-routes.js';
import type { LibraryService } from './library-service.js';

test('mudança de metadata invalida snapshot HTTP e projeta a visão efetiva', async () => {
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
    const baseStatus = {
      ready: true,
      scannedAt: '2026-08-28T00:00:00.000Z',
      scanning: false,
      revision: 7,
      autoRescan: { enabled: false, intervalSeconds: 0 }
    };

    const app = Fastify();
    const projection = registerAdminTrackRoutes(app, {
      listTracks: () => [track],
      setEnabled: () => track,
      setLocation: () => track
    }, {
      databasePath,
      musicDir,
      libraryProjectionHandledByRoutes: true
    });
    const library = {
      listPublicTracks: () => [track],
      status: () => baseStatus,
      rescan: async () => ({ added: 0, updated: 0, removed: 0, tracks: 1 }),
      overview: () => ({}),
      checkIntegrity: async () => null
    } as unknown as LibraryService;
    registerLibraryRoutes(app, library, undefined, projection);

    const initialStatus = await app.inject({ method: 'GET', url: '/api/library/status' });
    assert.equal(initialStatus.json().revision, 7);

    const initialLibrary = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: { 'accept-encoding': 'identity' }
    });
    assert.equal(initialLibrary.statusCode, 200);
    assert.equal(initialLibrary.json().tracks[0].title, 'Título físico');
    const initialEtag = initialLibrary.headers.etag;
    assert.ok(initialEtag);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tracks/track-a/metadata',
      payload: { title: 'Título corrigido', album: 'Álbum corrigido' }
    });
    assert.equal(patched.statusCode, 200);

    const status = await app.inject({ method: 'GET', url: '/api/library/status' });
    assert.equal(status.json().revision, 8);

    const libraryAfterPatch = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: {
        'accept-encoding': 'identity',
        'if-none-match': initialEtag
      }
    });
    assert.equal(libraryAfterPatch.statusCode, 200);
    assert.notEqual(libraryAfterPatch.headers.etag, initialEtag);
    assert.equal(libraryAfterPatch.json().revision, 8);
    assert.equal(libraryAfterPatch.json().tracks[0].title, 'Título corrigido');
    assert.equal(libraryAfterPatch.json().tracks[0].album, 'Álbum corrigido');
    assert.equal(track.title, 'Título físico');
    assert.equal(track.album, 'Álbum');

    const effectiveEtag = libraryAfterPatch.headers.etag;
    assert.ok(effectiveEtag);
    const notModified = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: { 'if-none-match': effectiveEtag }
    });
    assert.equal(notModified.statusCode, 304);

    const reset = await app.inject({ method: 'DELETE', url: '/api/admin/tracks/track-a/metadata' });
    assert.equal(reset.statusCode, 200);
    const libraryAfterReset = await app.inject({
      method: 'GET',
      url: '/api/library',
      headers: {
        'accept-encoding': 'identity',
        'if-none-match': effectiveEtag
      }
    });
    assert.equal(libraryAfterReset.statusCode, 200);
    assert.equal(libraryAfterReset.json().revision, 9);
    assert.equal(libraryAfterReset.json().tracks[0].title, 'Título físico');
    assert.notEqual(libraryAfterReset.headers.etag, effectiveEtag);

    await app.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
