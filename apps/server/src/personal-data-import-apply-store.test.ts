import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type {
  PersonalDataBundleV1,
  PersonalDataImportPreviewV1,
  PortableTrackReferenceV1
} from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import { HomeMusicDatabase } from './database.js';
import { LibraryViewStore } from './library-views.js';
import { PersonalDataImportApplyStore } from './personal-data-import-apply-store.js';
import type { PersonalDataImportPlan, PersonalDataImportPlannedReference } from './personal-data-import-plan.js';
import { SmartPlaylistStore } from './smart-playlists.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function reference(name: 'a' | 'b'): PortableTrackReferenceV1 {
  return {
    relativePath: `Colecao/${name}.mp3`,
    hints: {
      title: `Faixa ${name}`,
      artist: 'Artista',
      album: 'Album',
      durationSeconds: 180
    }
  };
}

function bundle(): PersonalDataBundleV1 {
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-06T12:00:00.000Z',
    favorites: [reference('a')],
    manualPlaylists: [{
      name: 'Viagem',
      tracks: [reference('a'), reference('b')],
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    smartPlaylists: [{
      name: 'Dinamica',
      rule: {
        artist: null,
        album: null,
        folderPath: null,
        favorite: null,
        history: 'any',
        periodDays: null,
        sort: 'title',
        limit: 50
      },
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    libraryViews: [{
      name: 'Sem capa',
      definition: {
        query: '',
        format: 'Todos',
        cover: 'without-cover',
        sort: 'current'
      },
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    playbackHistory: [{
      track: reference('a'),
      playedAt: '2026-09-05T18:00:00.000Z'
    }],
    playbackState: {
      currentTrack: reference('a'),
      position: 42,
      volume: 0.7,
      shuffle: true,
      repeatMode: 'all',
      wasPlaying: false,
      baseQueue: [reference('b')],
      queue: [reference('b'), reference('a')],
      updatedAt: '2026-09-05T18:30:00.000Z'
    }
  };
}

function found(
  domain: PersonalDataImportPlannedReference['domain'],
  field: string,
  location: PersonalDataImportPlannedReference['location'],
  ref: PortableTrackReferenceV1,
  trackId: string
): PersonalDataImportPlannedReference {
  return {
    domain,
    field,
    location,
    reference: ref,
    match: {
      status: 'found',
      trackId,
      strategy: 'relative-path',
      reason: 'relative-path',
      candidateTrackIds: []
    }
  };
}

function plan(): PersonalDataImportPlan {
  const value = bundle();
  const references: PersonalDataImportPlannedReference[] = [
    found('favorites', '$.favorites[0]', { kind: 'favorite', index: 0 }, value.favorites[0]!, 'track-a'),
    found(
      'manual-playlists',
      '$.manualPlaylists[0].tracks[0]',
      { kind: 'manual-playlist-track', playlistIndex: 0, trackIndex: 0 },
      value.manualPlaylists[0]!.tracks[0]!,
      'track-a'
    ),
    found(
      'manual-playlists',
      '$.manualPlaylists[0].tracks[1]',
      { kind: 'manual-playlist-track', playlistIndex: 0, trackIndex: 1 },
      value.manualPlaylists[0]!.tracks[1]!,
      'track-b'
    ),
    found(
      'playback-history',
      '$.playbackHistory[0].track',
      { kind: 'playback-history', index: 0 },
      value.playbackHistory[0]!.track,
      'track-a'
    ),
    found(
      'playback-state',
      '$.playbackState.currentTrack',
      { kind: 'playback-current' },
      value.playbackState.currentTrack!,
      'track-a'
    ),
    found(
      'playback-state',
      '$.playbackState.baseQueue[0]',
      { kind: 'playback-base-queue', index: 0 },
      value.playbackState.baseQueue[0]!,
      'track-b'
    ),
    found(
      'playback-state',
      '$.playbackState.queue[0]',
      { kind: 'playback-queue', index: 0 },
      value.playbackState.queue[0]!,
      'track-b'
    ),
    found(
      'playback-state',
      '$.playbackState.queue[1]',
      { kind: 'playback-queue', index: 1 },
      value.playbackState.queue[1]!,
      'track-a'
    )
  ];
  return { bundle: value, references, preview: preview(value) };
}

function preview(value: PersonalDataBundleV1): PersonalDataImportPreviewV1 {
  const foundAll = { total: 8, found: 8, missing: 0, ambiguous: 0, conflict: 0 };
  return {
    format: value.format,
    version: value.version,
    exportedAt: value.exportedAt,
    references: foundAll,
    domains: {
      favorites: {
        items: 1,
        references: { total: 1, found: 1, missing: 0, ambiguous: 0, conflict: 0 }
      },
      manualPlaylists: {
        items: 1,
        references: { total: 2, found: 2, missing: 0, ambiguous: 0, conflict: 0 }
      },
      smartPlaylists: { items: 1 },
      libraryViews: { items: 1 },
      playbackHistory: {
        items: 1,
        references: { total: 1, found: 1, missing: 0, ambiguous: 0, conflict: 0 }
      },
      playbackState: {
        references: { total: 4, found: 4, missing: 0, ambiguous: 0, conflict: 0 }
      }
    },
    issues: [],
    issuesTruncated: false
  };
}

async function withDatabase(run: (databasePath: string) => Promise<void> | void) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-personal-apply-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.close();

  const db = new DatabaseSync(databasePath);
  try {
    insertUser(db, USER_A, 'alice');
    insertUser(db, USER_B, 'bob');
    insertTrack(db, 'track-a', '/music/Colecao/a.mp3', 'Faixa a');
    insertTrack(db, 'track-b', '/music/Colecao/b.mp3', 'Faixa b');
  } finally {
    db.close();
  }

  try {
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function insertUser(db: DatabaseSync, id: string, username: string) {
  const now = '2026-09-06T10:00:00.000Z';
  db.prepare(`
    INSERT INTO users(
      id, username, username_normalized, password_hash, role, enabled,
      password_must_change, created_at, updated_at, password_changed_at
    ) VALUES (?, ?, ?, ?, 'user', 1, 0, ?, ?, ?)
  `).run(id, username, username, `hash-${username}`, now, now, now);
}

function insertTrack(db: DatabaseSync, id: string, filePath: string, title: string) {
  db.prepare(`
    INSERT INTO tracks(
      id, file_path, title, artist, album, album_artist, folder, folder_path,
      duration, format, has_cover, mime_type, file_size, mtime_ms
    ) VALUES (?, ?, ?, 'Artista', 'Album', 'Artista', 'Colecao', 'Colecao',
              180, 'MP3', 0, 'audio/mpeg', 1000, 1)
  `).run(id, filePath, title);
}

test('apply importa todos os domínios e replay do mesmo plano é idempotente', async () => {
  await withDatabase(databasePath => {
    const store = new PersonalDataImportApplyStore(databasePath);
    try {
      const first = store.apply(USER_A, plan());
      assert.equal(first.applied, 6);
      assert.equal(first.ignored, 0);
      assert.deepEqual(first.domains.favorites, { applied: 1, ignored: 0 });
      assert.deepEqual(first.domains.manualPlaylists, { applied: 1, ignored: 0 });
      assert.deepEqual(first.domains.smartPlaylists, { applied: 1, ignored: 0 });
      assert.deepEqual(first.domains.libraryViews, { applied: 1, ignored: 0 });
      assert.deepEqual(first.domains.playbackHistory, { applied: 1, ignored: 0 });
      assert.deepEqual(first.domains.playbackState, { applied: 1, ignored: 0 });

      const second = store.apply(USER_A, plan());
      assert.equal(second.applied, 0);
      assert.equal(second.ignored, 6);
    } finally {
      store.close();
    }

    const db = new DatabaseSync(databasePath);
    try {
      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?').get(USER_A) as { total: number }).total),
        1
      );
      assert.equal(
        Number((db.prepare("SELECT COUNT(*) AS total FROM playlists WHERE owner_user_id = ? AND source = 'manual'").get(USER_A) as { total: number }).total),
        1
      );
      const playlist = db.prepare(`
        SELECT id FROM playlists
        WHERE owner_user_id = ? AND source = 'manual' AND name = 'Viagem'
      `).get(USER_A) as { id: string };
      const playlistTracks = db.prepare(`
        SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC
      `).all(playlist.id) as Array<{ track_id: string }>;
      assert.deepEqual(playlistTracks.map(item => item.track_id), ['track-a', 'track-b']);
      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM history WHERE user_id = ?').get(USER_A) as { total: number }).total),
        1
      );
      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?').get(USER_B) as { total: number }).total),
        0
      );
      const state = db.prepare(`
        SELECT current_track_id, base_queue_json, queue_json
        FROM playback_state WHERE user_id = ?
      `).get(USER_A) as { current_track_id: string; base_queue_json: string; queue_json: string };
      assert.equal(state.current_track_id, 'track-a');
      assert.deepEqual(JSON.parse(state.base_queue_json), ['track-a', 'track-b']);
      assert.deepEqual(JSON.parse(state.queue_json), ['track-b', 'track-a']);
    } finally {
      db.close();
    }

    const smart = new SmartPlaylistStore(databasePath);
    try {
      const imported = smart.list(USER_A, new Set(['track-a', 'track-b']));
      assert.equal(imported.length, 1);
      assert.equal(imported[0]?.name, 'Dinamica');
      assert.deepEqual(imported[0]?.rule, bundle().smartPlaylists[0]?.rule);
    } finally {
      smart.close();
    }

    const views = new LibraryViewStore(databasePath);
    try {
      assert.deepEqual(
        views.list(USER_A).map(view => ({ name: view.name, definition: view.definition })),
        [{ name: 'Sem capa', definition: bundle().libraryViews[0]!.definition }]
      );
    } finally {
      views.close();
    }
  });
});

test('falha depois de writes anteriores faz rollback integral da transação', async () => {
  await withDatabase(databasePath => {
    const store = new PersonalDataImportApplyStore(databasePath);
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        CREATE TRIGGER force_personal_import_failure
        BEFORE INSERT ON library_views
        BEGIN
          SELECT RAISE(ABORT, 'forced personal import failure');
        END;
      `);

      assert.throws(() => store.apply(USER_A, plan()), /forced personal import failure/);

      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?').get(USER_A) as { total: number }).total),
        0
      );
      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM playlists WHERE owner_user_id = ?').get(USER_A) as { total: number }).total),
        0
      );
      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM history WHERE user_id = ?').get(USER_A) as { total: number }).total),
        0
      );
      assert.equal(
        Number((db.prepare('SELECT COUNT(*) AS total FROM playback_state WHERE user_id = ?').get(USER_A) as { total: number }).total),
        0
      );
    } finally {
      db.close();
      store.close();
    }
  });
});
