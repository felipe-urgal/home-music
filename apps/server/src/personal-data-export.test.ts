import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_HISTORY_LIMIT,
  PERSONAL_DATA_VERSION,
  type PersonalDataBundleV1,
  type PortableTrackReferenceV1
} from '@home-music/shared/personal-data';
import { HomeMusicDatabase } from './database.js';
import { LibraryViewStore } from './library-views.js';
import { PersonalDataExportService } from './personal-data-export.js';
import { registerPersonalDataExportRoutes } from './personal-data-export-routes.js';
import { SmartPlaylistStore } from './smart-playlists.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function track(id: string) {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Coleção',
    folderPath: 'Coleção',
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
}

function reference(id: string): PortableTrackReferenceV1 {
  return {
    relativePath: `Coleção/${id}.mp3`,
    hints: {
      title: `Faixa ${id}`,
      artist: 'Artista',
      album: 'Álbum',
      durationSeconds: 180
    }
  };
}

function insertUser(databasePath: string, id: string) {
  const db = new DatabaseSync(databasePath);
  try {
    const now = '2026-09-05T18:00:00.000Z';
    db.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
    `).run(id, id, id, `hash-${id}`, now, now, now);
  } finally {
    db.close();
  }
}

async function withDatabase(run: (databasePath: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-personal-export-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.close();
  insertUser(databasePath, USER_A);
  insertUser(databasePath, USER_B);
  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function emptyBundle(): PersonalDataBundleV1 {
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-05T18:30:00.000Z',
    favorites: [],
    manualPlaylists: [],
    smartPlaylists: [],
    libraryViews: [],
    playbackHistory: [],
    playbackState: {
      currentTrack: null,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueue: [],
      queue: [],
      updatedAt: new Date(0).toISOString()
    }
  };
}

test('export pessoal v1 preserva dados portáveis sem materializar smart playlist nem vazar outra conta', async () => {
  await withDatabase(async databasePath => {
    const smart = new SmartPlaylistStore(databasePath);
    smart.create(USER_A, 'Favoritas recentes', {
      artist: null,
      album: null,
      folderPath: null,
      favorite: true,
      history: 'any',
      periodDays: null,
      sort: 'title',
      limit: 50
    });
    smart.create(USER_B, 'NÃO PODE VAZAR', {
      artist: null,
      album: null,
      folderPath: null,
      favorite: null,
      history: 'never',
      periodDays: null,
      sort: 'title',
      limit: 10
    });
    smart.close();

    const views = new LibraryViewStore(databasePath);
    views.create(USER_A, 'Sem capa', {
      query: '',
      format: 'Todos',
      cover: 'without-cover',
      sort: 'current'
    });
    views.create(USER_B, 'VIEW ESTRANGEIRA', {
      query: '',
      format: 'Todos',
      cover: 'all',
      sort: 'current'
    });
    views.close();

    let historyLimit = 0;
    const personal = {
      getFavoriteIds(userId: string) {
        assert.equal(userId, USER_A);
        return ['a', 'b'];
      },
      getPlaylists(userId: string) {
        assert.equal(userId, USER_A);
        return [
          {
            id: 'manual-a',
            name: 'Minha ordem',
            trackIds: ['b', 'a'],
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-02T10:00:00.000Z',
            source: 'manual' as const
          },
          {
            id: 'rekordbox-shared',
            name: 'Não exportar',
            trackIds: ['foreign'],
            createdAt: '2026-09-01T10:00:00.000Z',
            updatedAt: '2026-09-02T10:00:00.000Z',
            source: 'rekordbox' as const
          }
        ];
      },
      getHistory(userId: string, limit: number) {
        assert.equal(userId, USER_A);
        historyLimit = limit;
        return [{ id: 1, track: track('a'), playedAt: '2026-09-04T10:00:00.000Z' }];
      },
      loadPlaybackState(userId: string) {
        assert.equal(userId, USER_A);
        return {
          currentTrackId: 'b',
          position: 42,
          volume: 0.7,
          shuffle: true,
          repeatMode: 'all' as const,
          wasPlaying: true,
          baseQueueIds: ['a', 'b'],
          queueIds: ['b', 'a'],
          updatedAt: '2026-09-05T17:00:00.000Z'
        };
      },
      portableTrackReferences(trackIds: readonly string[]) {
        assert.deepEqual([...new Set(trackIds)].sort(), ['a', 'b']);
        return new Map([
          ['a', reference('a')],
          ['b', reference('b')]
        ]);
      }
    };

    const exporter = new PersonalDataExportService(
      personal,
      databasePath,
      () => new Date('2026-09-05T18:30:00.000Z')
    );
    try {
      const bundle = exporter.exportForUser(USER_A);
      assert.equal(historyLimit, PERSONAL_DATA_HISTORY_LIMIT);
      assert.equal(bundle.format, PERSONAL_DATA_FORMAT);
      assert.equal(bundle.version, PERSONAL_DATA_VERSION);
      assert.deepEqual(bundle.favorites.map(item => item.relativePath), [
        'Coleção/a.mp3',
        'Coleção/b.mp3'
      ]);
      assert.deepEqual(bundle.manualPlaylists.map(item => item.name), ['Minha ordem']);
      assert.deepEqual(
        bundle.manualPlaylists[0]?.tracks.map(item => item.relativePath),
        ['Coleção/b.mp3', 'Coleção/a.mp3']
      );
      assert.deepEqual(bundle.smartPlaylists.map(item => item.name), ['Favoritas recentes']);
      assert.equal('trackIds' in (bundle.smartPlaylists[0] ?? {}), false);
      assert.deepEqual(bundle.libraryViews.map(item => item.name), ['Sem capa']);
      assert.deepEqual(bundle.playbackState.queue.map(item => item.relativePath), [
        'Coleção/b.mp3',
        'Coleção/a.mp3'
      ]);

      const serialized = JSON.stringify(bundle);
      assert.equal(serialized.includes('NÃO PODE VAZAR'), false);
      assert.equal(serialized.includes('VIEW ESTRANGEIRA'), false);
      assert.equal(serialized.includes('hash-'), false);
      assert.equal(serialized.includes('/music/'), false);
      assert.equal(serialized.includes('foreign'), false);
    } finally {
      exporter.close();
    }
  });
});

test('rota de export usa somente a identidade autenticada e força download privado', async () => {
  const app = Fastify();
  const requestedUserIds: string[] = [];
  registerPersonalDataExportRoutes(app, {
    exportForUser(userId: string) {
      requestedUserIds.push(userId);
      return emptyBundle();
    }
  });

  app.addHook('preHandler', async request => {
    request.user = { id: USER_A, username: 'alice', role: 'user' };
  });

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/account/personal-data/export?userId=${encodeURIComponent(USER_B)}`
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(requestedUserIds, [USER_A]);
    assert.match(response.headers['content-type'] ?? '', /^application\/json/);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.match(response.headers['content-disposition'] ?? '', /home-music-personal-data-v1\.json/);
  } finally {
    await app.close();
  }
});
