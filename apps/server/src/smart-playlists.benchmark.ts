import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import type { SmartPlaylistRule } from '@home-music/shared';
import { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import { SmartPlaylistStore } from './smart-playlists.js';

const DEFAULT_TRACKS = 10_000;
const DEFAULT_PLAYLISTS = 16;

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const TRACK_COUNT = positiveInteger(process.env.HOME_MUSIC_BENCHMARK_TRACKS, DEFAULT_TRACKS);
const PLAYLIST_COUNT = positiveInteger(process.env.HOME_MUSIC_BENCHMARK_SMART_PLAYLISTS, DEFAULT_PLAYLISTS);

function track(index: number): IndexedTrack {
  const artistIndex = index % 100;
  const albumIndex = index % 250;
  const folderIndex = index % 20;
  return {
    id: `track-${index}`,
    title: `Faixa ${String(index).padStart(5, '0')}`,
    artist: `Artista ${artistIndex}`,
    album: `Álbum ${albumIndex}`,
    albumArtist: `Artista ${artistIndex}`,
    folder: `Gênero ${folderIndex}`,
    folderPath: `Gênero ${folderIndex}/Artista ${artistIndex}`,
    duration: 180,
    format: index % 4 === 0 ? 'FLAC' : 'MP3',
    hasCover: index % 3 === 0,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: `/music/track-${index}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 1000 + index,
    mtimeMs: index + 1
  };
}

function seedUserData(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    const now = '2026-09-01T00:00:00.000Z';
    db.prepare(`
      INSERT INTO users(
        id, username, username_normalized, password_hash, role, enabled,
        password_must_change, created_at, updated_at, password_changed_at
      ) VALUES ('benchmark-user', 'benchmark-user', 'benchmark-user', 'hash', 'user', 1, 0, ?, ?, ?)
    `).run(now, now, now);

    const favorite = db.prepare(`
      INSERT INTO favorites(user_id, track_id, created_at)
      VALUES ('benchmark-user', ?, ?)
    `);
    for (let index = 0; index < TRACK_COUNT; index += 7) {
      favorite.run(`track-${index}`, `2026-08-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`);
    }

    const history = db.prepare(`
      INSERT INTO history(user_id, track_id, played_at)
      VALUES ('benchmark-user', ?, ?)
    `);
    const historyRows = Math.min(2_000, TRACK_COUNT * 2);
    for (let index = 0; index < historyRows; index += 1) {
      const day = String((index % 28) + 1).padStart(2, '0');
      const hour = String(index % 24).padStart(2, '0');
      history.run(`track-${index % TRACK_COUNT}`, `2026-08-${day}T${hour}:00:00.000Z`);
    }

    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}

function rule(index: number): SmartPlaylistRule {
  const variant = index % 5;
  if (variant === 0) {
    return {
      artist: null,
      album: null,
      folderPath: null,
      favorite: null,
      history: 'played',
      periodDays: 30,
      sort: 'most-played',
      limit: 250
    };
  }
  if (variant === 1) {
    return {
      artist: null,
      album: null,
      folderPath: null,
      favorite: null,
      history: 'played',
      periodDays: 7,
      sort: 'recently-played',
      limit: 250
    };
  }
  if (variant === 2) {
    return {
      artist: null,
      album: null,
      folderPath: null,
      favorite: null,
      history: 'never',
      periodDays: null,
      sort: 'title',
      limit: 250
    };
  }
  if (variant === 3) {
    return {
      artist: null,
      album: null,
      folderPath: null,
      favorite: true,
      history: 'any',
      periodDays: null,
      sort: 'oldest-favorite',
      limit: 250
    };
  }
  return {
    artist: `Artista ${index % 100}`,
    album: null,
    folderPath: null,
    favorite: null,
    history: 'any',
    periodDays: null,
    sort: 'title',
    limit: 250
  };
}

function measure<T>(operation: () => T) {
  const startedAt = performance.now();
  const value = operation();
  return {
    value,
    durationMs: Number((performance.now() - startedAt).toFixed(2))
  };
}

async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-smart-playlist-benchmark-'));
  const databasePath = path.join(temp, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);

  try {
    database.syncTracks(
      Array.from({ length: TRACK_COUNT }, (_, index) => track(index)),
      '/music',
      '2026-09-01T00:00:00.000Z'
    );
    seedUserData(databasePath);

    const store = new SmartPlaylistStore(databasePath);
    try {
      for (let index = 0; index < PLAYLIST_COUNT; index += 1) {
        store.create('benchmark-user', `Smart ${index + 1}`, rule(index));
      }

      store.list('benchmark-user', undefined, new Date('2026-09-01T00:00:00.000Z'));

      const shared = measure(() =>
        store.list('benchmark-user', undefined, new Date('2026-09-01T00:00:00.000Z'))
      );
      const independent = measure(() =>
        shared.value.map(playlist => ({
          id: playlist.id,
          trackIds: store.evaluate(
            'benchmark-user',
            playlist.rule as SmartPlaylistRule,
            undefined,
            new Date('2026-09-01T00:00:00.000Z')
          )
        }))
      );

      const independentById = new Map(independent.value.map(item => [item.id, item.trackIds]));
      for (const playlist of shared.value) {
        assert.deepEqual(playlist.trackIds, independentById.get(playlist.id));
      }

      console.log(JSON.stringify({
        benchmark: 'smart-playlist-list',
        dataset: {
          tracks: TRACK_COUNT,
          smartPlaylists: PLAYLIST_COUNT,
          historyRows: Math.min(2_000, TRACK_COUNT * 2)
        },
        measurements: {
          sharedListMs: shared.durationMs,
          independentEvaluationBaselineMs: independent.durationMs,
          speedupVsIndependent: shared.durationMs > 0
            ? Number((independent.durationMs / shared.durationMs).toFixed(2))
            : null
        }
      }, null, 2));
    } finally {
      store.close();
    }
  } finally {
    database.close();
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
