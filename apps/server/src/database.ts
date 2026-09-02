import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import type { PlaybackState, Playlist, PlaylistSource, RepeatMode, StatisticsPeriod, Track } from '@home-music/shared';
import type { IndexedTrack, LibraryTrackDelta } from './library.js';

const CURRENT_SCHEMA_VERSION = 11;
const HISTORY_CAPACITY = 2_000;

const DEFAULT_PLAYBACK_STATE: PlaybackState = {
  currentTrackId: null,
  position: 0,
  volume: 1,
  shuffle: false,
  repeatMode: 'off',
  wasPlaying: false,
  baseQueueIds: [],
  queueIds: [],
  updatedAt: new Date(0).toISOString()
};

type Row = Record<string, unknown>;

type ImportedPlaylist = {
  sourceKey: string;
  name: string;
  trackIds: string[];
};

export type TrackPersistenceMetrics = {
  mode: 'full' | 'delta';
  upserted: number;
  removed: number;
  durationMs: number;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function requireUserId(userId: string) {
  if (!userId || userId.length > 128) throw new RangeError('userId pessoal inválido.');
}

function repeatModeValue(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off';
}

function playlistSourceValue(value: unknown): PlaylistSource {
  return value === 'rekordbox' ? 'rekordbox' : 'manual';
}

function stringArrayValue(value: unknown) {
  try {
    const parsed = JSON.parse(stringValue(value, '[]'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function publicTrackFromRow(row: Row): Track {
  return {
    id: stringValue(row.id),
    title: stringValue(row.title),
    artist: stringValue(row.artist),
    album: stringValue(row.album),
    albumArtist: stringValue(row.album_artist),
    folder: stringValue(row.folder, 'Sem pasta'),
    folderPath: stringValue(row.folder_path),
    duration: row.duration == null ? null : numberValue(row.duration),
    format: stringValue(row.format),
    hasCover: Boolean(row.has_cover),
    replayGainTrackDb: row.replaygain_track_db == null ? null : numberValue(row.replaygain_track_db),
    replayGainAlbumDb: row.replaygain_album_db == null ? null : numberValue(row.replaygain_album_db)
  };
}

export class HomeMusicDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private schemaVersion() {
    const row = this.db.prepare('PRAGMA user_version;').get() as Row | undefined;
    return numberValue(row?.user_version);
  }

  private hasColumn(table: string, column: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table});`).all() as Row[];
    return rows.some(row => stringValue(row.name) === column);
  }

  private migrate() {
    let version = this.schemaVersion();

    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tracks (
          id TEXT PRIMARY KEY,
          file_path TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          artist TEXT NOT NULL,
          album TEXT NOT NULL,
          album_artist TEXT NOT NULL,
          folder TEXT NOT NULL,
          folder_path TEXT NOT NULL DEFAULT '',
          duration REAL,
          format TEXT NOT NULL,
          has_cover INTEGER NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          mtime_ms REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_artist, album);
        CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder_path);

        CREATE TABLE IF NOT EXISTS favorites (
          track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          played_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_history_played_at ON history(played_at DESC);

        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
          playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          PRIMARY KEY (playlist_id, position),
          UNIQUE (playlist_id, track_id)
        );

        CREATE TABLE IF NOT EXISTS playback_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          current_track_id TEXT,
          position REAL NOT NULL DEFAULT 0,
          volume REAL NOT NULL DEFAULT 1,
          shuffle INTEGER NOT NULL DEFAULT 0,
          repeat_mode TEXT NOT NULL DEFAULT 'off',
          queue_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        );

        PRAGMA user_version = 1;
      `);
      version = 1;
    }

    if (version < 2) {
      if (!this.hasColumn('playback_state', 'base_queue_json')) {
        this.db.exec(`ALTER TABLE playback_state ADD COLUMN base_queue_json TEXT NOT NULL DEFAULT '[]';`);
      }
      this.db.exec('PRAGMA user_version = 2;');
      version = 2;
    }

    if (version < 3) {
      if (!this.hasColumn('playback_state', 'was_playing')) {
        this.db.exec(`ALTER TABLE playback_state ADD COLUMN was_playing INTEGER NOT NULL DEFAULT 0;`);
      }
      this.db.exec('PRAGMA user_version = 3;');
      version = 3;
    }

    if (version < 4) {
      if (this.hasColumn('tracks', 'id')) {
        if (!this.hasColumn('tracks', 'replaygain_track_db')) {
          this.db.exec('ALTER TABLE tracks ADD COLUMN replaygain_track_db REAL;');
        }
        if (!this.hasColumn('tracks', 'replaygain_album_db')) {
          this.db.exec('ALTER TABLE tracks ADD COLUMN replaygain_album_db REAL;');
        }
      }
      if (this.hasColumn('metadata', 'key')) {
        // Força um único re-scan após o upgrade para preencher as tags novas.
        this.db.prepare('DELETE FROM metadata WHERE key = ?').run('scannedAt');
      }
      this.db.exec('PRAGMA user_version = 4;');
      version = 4;
    }

    if (version < 5) {
      if (this.hasColumn('playlists', 'id')) {
        if (!this.hasColumn('playlists', 'source')) {
          this.db.exec("ALTER TABLE playlists ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';");
        }
        if (!this.hasColumn('playlists', 'source_key')) {
          this.db.exec('ALTER TABLE playlists ADD COLUMN source_key TEXT;');
        }
        this.db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_source_key
          ON playlists(source, source_key)
          WHERE source_key IS NOT NULL;
        `);
      }
      this.db.exec('PRAGMA user_version = 5;');
      version = 5;
    }

    if (version < 6) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY NOT NULL,
            username TEXT NOT NULL CHECK(length(username) BETWEEN 1 AND 120),
            username_normalized TEXT NOT NULL UNIQUE CHECK(length(username_normalized) BETWEEN 1 AND 120),
            password_hash TEXT NOT NULL CHECK(length(password_hash) > 0),
            role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
            enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
            password_must_change INTEGER NOT NULL DEFAULT 0 CHECK(password_must_change IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            password_changed_at TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_users_role_enabled ON users(role, enabled);
          PRAGMA user_version = 6;
        `);
        this.db.exec('COMMIT;');
        version = 6;
      } catch (error) {
        this.db.exec('ROLLBACK;');
        throw error;
      }
    }

    if (version < 7) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const firstUser = this.db.prepare(`
          SELECT id
          FROM users
          ORDER BY created_at ASC, id ASC
          LIMIT 1;
        `).get() as Row | undefined;
        const firstUserId = stringValue(firstUser?.id);
        const hasLegacyFavorites = this.hasColumn('favorites', 'track_id');

        if (hasLegacyFavorites) {
          this.db.exec('ALTER TABLE favorites RENAME TO favorites_legacy;');
        }

        this.db.exec(`
          CREATE TABLE favorites (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, track_id)
          );

          CREATE INDEX idx_favorites_user_created_at
          ON favorites(user_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS legacy_favorites_pending (
            track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
          );
        `);

        if (hasLegacyFavorites && firstUserId) {
          this.db.prepare(`
            INSERT INTO favorites(user_id, track_id, created_at)
            SELECT ?, track_id, created_at
            FROM favorites_legacy;
          `).run(firstUserId);
        } else if (hasLegacyFavorites) {
          this.db.exec(`
            INSERT INTO legacy_favorites_pending(track_id, created_at)
            SELECT track_id, created_at
            FROM favorites_legacy;
          `);
        }

        this.db.exec(`
          DROP TABLE IF EXISTS favorites_legacy;
          PRAGMA user_version = 7;
        `);
        this.db.exec('COMMIT;');
        version = 7;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Preserva o erro original se a transação já tiver sido encerrada.
        }
        throw error;
      }
    }

    if (version < 8) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const firstUser = this.db.prepare(`
          SELECT id
          FROM users
          ORDER BY created_at ASC, id ASC
          LIMIT 1;
        `).get() as Row | undefined;
        const firstUserId = stringValue(firstUser?.id);
        const hasHistory = this.hasColumn('history', 'track_id');
        const historyAlreadyOwned = this.hasColumn('history', 'user_id');
        const hasLegacyHistory = hasHistory && !historyAlreadyOwned;

        if (hasLegacyHistory) {
          this.db.exec('ALTER TABLE history RENAME TO history_legacy;');
        }

        this.db.exec(`
          CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            played_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_history_user_played_at
          ON history(user_id, played_at DESC, id DESC);

          CREATE TABLE IF NOT EXISTS legacy_history_pending (
            id INTEGER PRIMARY KEY,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            played_at TEXT NOT NULL
          );
        `);

        if (hasLegacyHistory && firstUserId) {
          this.db.prepare(`
            INSERT INTO history(id, user_id, track_id, played_at)
            SELECT id, ?, track_id, played_at
            FROM history_legacy
            ORDER BY id ASC;
          `).run(firstUserId);
        } else if (hasLegacyHistory) {
          this.db.exec(`
            INSERT INTO legacy_history_pending(id, track_id, played_at)
            SELECT id, track_id, played_at
            FROM history_legacy
            ORDER BY id ASC;
          `);
        }

        this.db.exec(`
          DROP TABLE IF EXISTS history_legacy;
          PRAGMA user_version = 8;
        `);
        this.db.exec('COMMIT;');
        version = 8;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Preserva o erro original se a transação já tiver sido encerrada.
        }
        throw error;
      }
    }

    if (version < 9) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const firstUser = this.db.prepare(`
          SELECT id
          FROM users
          ORDER BY created_at ASC, id ASC
          LIMIT 1;
        `).get() as Row | undefined;
        const firstUserId = stringValue(firstUser?.id);
        const hasPlaylists = this.hasColumn('playlists', 'id');

        if (!hasPlaylists) {
          this.db.exec(`
            CREATE TABLE playlists (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'manual',
              source_key TEXT,
              owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE
            );
          `);
        } else if (!this.hasColumn('playlists', 'owner_user_id')) {
          this.db.exec(`
            ALTER TABLE playlists
            ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
          `);
        }

        this.db.exec(`
          CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, position),
            UNIQUE (playlist_id, track_id)
          );

          CREATE TABLE IF NOT EXISTS legacy_manual_playlists_pending (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS legacy_manual_playlist_tracks_pending (
            playlist_id TEXT NOT NULL REFERENCES legacy_manual_playlists_pending(id) ON DELETE CASCADE,
            track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, position),
            UNIQUE (playlist_id, track_id)
          );
        `);

        this.db.exec(`
          UPDATE playlists
          SET source = 'manual'
          WHERE source NOT IN ('manual', 'rekordbox');

          UPDATE playlists
          SET owner_user_id = NULL
          WHERE source = 'rekordbox';
        `);

        if (firstUserId) {
          this.db.prepare(`
            UPDATE playlists
            SET owner_user_id = ?
            WHERE source = 'manual' AND owner_user_id IS NULL;
          `).run(firstUserId);
        } else {
          this.db.exec(`
            INSERT INTO legacy_manual_playlists_pending(id, name, created_at, updated_at)
            SELECT id, name, created_at, updated_at
            FROM playlists
            WHERE source = 'manual';

            INSERT INTO legacy_manual_playlist_tracks_pending(playlist_id, track_id, position)
            SELECT pt.playlist_id, pt.track_id, pt.position
            FROM playlist_tracks pt
            JOIN playlists p ON p.id = pt.playlist_id
            WHERE p.source = 'manual';

            DELETE FROM playlists WHERE source = 'manual';
          `);
        }

        this.db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_source_key
          ON playlists(source, source_key)
          WHERE source_key IS NOT NULL;

          CREATE INDEX IF NOT EXISTS idx_playlists_owner_source_updated
          ON playlists(owner_user_id, source, updated_at DESC);

          CREATE TRIGGER IF NOT EXISTS trg_playlists_owner_insert
          BEFORE INSERT ON playlists
          WHEN NEW.source NOT IN ('manual', 'rekordbox')
            OR (NEW.source = 'manual' AND NEW.owner_user_id IS NULL)
            OR (NEW.source = 'rekordbox' AND NEW.owner_user_id IS NOT NULL)
          BEGIN
            SELECT RAISE(ABORT, 'ownership de playlist inválido');
          END;

          CREATE TRIGGER IF NOT EXISTS trg_playlists_owner_update
          BEFORE UPDATE OF source, owner_user_id ON playlists
          WHEN NEW.source NOT IN ('manual', 'rekordbox')
            OR (NEW.source = 'manual' AND NEW.owner_user_id IS NULL)
            OR (NEW.source = 'rekordbox' AND NEW.owner_user_id IS NOT NULL)
          BEGIN
            SELECT RAISE(ABORT, 'ownership de playlist inválido');
          END;

          PRAGMA user_version = 9;
        `);
        this.db.exec('COMMIT;');
        version = 9;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Preserva o erro original se a transação já tiver sido encerrada.
        }
        throw error;
      }
    }

    if (version < 10) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const firstUser = this.db.prepare(`
          SELECT id
          FROM users
          ORDER BY created_at ASC, id ASC
          LIMIT 1;
        `).get() as Row | undefined;
        const firstUserId = stringValue(firstUser?.id);
        const hasPlaybackState = this.hasColumn('playback_state', 'updated_at');
        const playbackStateAlreadyOwned = this.hasColumn('playback_state', 'user_id');
        const hasLegacyPlaybackState = hasPlaybackState && !playbackStateAlreadyOwned;

        if (hasLegacyPlaybackState) {
          this.db.exec('ALTER TABLE playback_state RENAME TO playback_state_legacy;');
        }

        this.db.exec(`
          CREATE TABLE IF NOT EXISTS playback_state (
            user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            current_track_id TEXT,
            position REAL NOT NULL DEFAULT 0,
            volume REAL NOT NULL DEFAULT 1,
            shuffle INTEGER NOT NULL DEFAULT 0,
            repeat_mode TEXT NOT NULL DEFAULT 'off',
            was_playing INTEGER NOT NULL DEFAULT 0,
            base_queue_json TEXT NOT NULL DEFAULT '[]',
            queue_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS legacy_playback_state_pending (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            current_track_id TEXT,
            position REAL NOT NULL DEFAULT 0,
            volume REAL NOT NULL DEFAULT 1,
            shuffle INTEGER NOT NULL DEFAULT 0,
            repeat_mode TEXT NOT NULL DEFAULT 'off',
            was_playing INTEGER NOT NULL DEFAULT 0,
            base_queue_json TEXT NOT NULL DEFAULT '[]',
            queue_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
          );
        `);

        if (hasLegacyPlaybackState && firstUserId) {
          this.db.prepare(`
            INSERT INTO playback_state(
              user_id, current_track_id, position, volume, shuffle, repeat_mode,
              was_playing, base_queue_json, queue_json, updated_at
            )
            SELECT ?, current_track_id, position, volume, shuffle, repeat_mode,
                   was_playing, base_queue_json, queue_json, updated_at
            FROM playback_state_legacy
            WHERE id = 1;
          `).run(firstUserId);
        } else if (hasLegacyPlaybackState) {
          this.db.exec(`
            INSERT OR REPLACE INTO legacy_playback_state_pending(
              id, current_track_id, position, volume, shuffle, repeat_mode,
              was_playing, base_queue_json, queue_json, updated_at
            )
            SELECT id, current_track_id, position, volume, shuffle, repeat_mode,
                   was_playing, base_queue_json, queue_json, updated_at
            FROM playback_state_legacy
            WHERE id = 1;
          `);
        }

        this.db.exec(`
          DROP TABLE IF EXISTS playback_state_legacy;
          PRAGMA user_version = 10;
        `);
        this.db.exec('COMMIT;');
        version = 10;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Preserva o erro original se a transação já tiver sido encerrada.
        }
        throw error;
      }
    }

    if (version < 11) {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(`
          DROP TRIGGER IF EXISTS trg_playlists_owner_insert;
          DROP TRIGGER IF EXISTS trg_playlists_owner_update;

          CREATE TRIGGER trg_playlists_owner_insert
          BEFORE INSERT ON playlists
          WHEN NEW.source NOT IN ('manual', 'smart', 'rekordbox')
            OR (NEW.source IN ('manual', 'smart') AND NEW.owner_user_id IS NULL)
            OR (NEW.source = 'rekordbox' AND NEW.owner_user_id IS NOT NULL)
          BEGIN
            SELECT RAISE(ABORT, 'ownership de playlist inválido');
          END;

          CREATE TRIGGER trg_playlists_owner_update
          BEFORE UPDATE OF source, owner_user_id ON playlists
          WHEN NEW.source NOT IN ('manual', 'smart', 'rekordbox')
            OR (NEW.source IN ('manual', 'smart') AND NEW.owner_user_id IS NULL)
            OR (NEW.source = 'rekordbox' AND NEW.owner_user_id IS NOT NULL)
          BEGIN
            SELECT RAISE(ABORT, 'ownership de playlist inválido');
          END;

          PRAGMA user_version = 11;
        `);
        this.db.exec('COMMIT;');
        version = 11;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Preserva o erro original se a transação já tiver sido encerrada.
        }
        throw error;
      }
    }

    if (version !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`Versão de schema SQLite não suportada: ${version}`);
    }
  }

  getSchemaVersion() {
    return this.schemaVersion();
  }

  close() {
    this.db.close();
  }

  getMetadata(key: string) {
    const row = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as Row | undefined;
    return row ? stringValue(row.value) : undefined;
  }

  private setMetadata(key: string, value: string) {
    this.db.prepare(`
      INSERT INTO metadata(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  private upsertTracks(tracks: readonly IndexedTrack[]) {
    if (tracks.length === 0) return;
    const upsert = this.db.prepare(`
      INSERT INTO tracks(
        id, file_path, title, artist, album, album_artist, folder, folder_path,
        duration, format, has_cover, replaygain_track_db, replaygain_album_db,
        mime_type, file_size, mtime_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_path = excluded.file_path,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        album_artist = excluded.album_artist,
        folder = excluded.folder,
        folder_path = excluded.folder_path,
        duration = excluded.duration,
        format = excluded.format,
        has_cover = excluded.has_cover,
        replaygain_track_db = excluded.replaygain_track_db,
        replaygain_album_db = excluded.replaygain_album_db,
        mime_type = excluded.mime_type,
        file_size = excluded.file_size,
        mtime_ms = excluded.mtime_ms
    `);

    for (const track of tracks) {
      upsert.run(
        track.id,
        track.filePath,
        track.title,
        track.artist,
        track.album,
        track.albumArtist,
        track.folder,
        track.folderPath,
        track.duration,
        track.format,
        track.hasCover ? 1 : 0,
        track.replayGainTrackDb ?? null,
        track.replayGainAlbumDb ?? null,
        track.mimeType,
        track.fileSize,
        track.mtimeMs
      );
    }
  }

  private removeTrackIds(trackIds: readonly string[]) {
    if (trackIds.length === 0) return 0;
    const remove = this.db.prepare('DELETE FROM tracks WHERE id = ?');
    let removed = 0;
    for (const trackId of trackIds) {
      removed += Number(remove.run(trackId).changes);
    }
    return removed;
  }

  private persistTrackChanges(
    upserts: readonly IndexedTrack[],
    removedIds: readonly string[],
    libraryRoot: string,
    scannedAt: string,
    mode: TrackPersistenceMetrics['mode']
  ): TrackPersistenceMetrics {
    const startedAt = performance.now();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.upsertTracks(upserts);
      const removed = this.removeTrackIds(removedIds);
      this.setMetadata('libraryRoot', libraryRoot);
      this.setMetadata('scannedAt', scannedAt);
      this.db.exec('COMMIT;');
      return {
        mode,
        upserted: upserts.length,
        removed,
        durationMs: Number((performance.now() - startedAt).toFixed(2))
      };
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  loadTracks(): IndexedTrack[] {
    const rows = this.db.prepare(`
      SELECT id, file_path, title, artist, album, album_artist, folder, folder_path,
             duration, format, has_cover, replaygain_track_db, replaygain_album_db,
             mime_type, file_size, mtime_ms
      FROM tracks
      ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE
    `).all() as Row[];

    return rows.map(row => ({
      ...publicTrackFromRow(row),
      filePath: stringValue(row.file_path),
      mimeType: stringValue(row.mime_type, 'application/octet-stream'),
      fileSize: numberValue(row.file_size),
      mtimeMs: numberValue(row.mtime_ms)
    }));
  }

  syncTracks(tracks: IndexedTrack[], libraryRoot: string, scannedAt: string) {
    const incomingIds = new Set(tracks.map(track => track.id));
    const staleIds = (this.db.prepare('SELECT id FROM tracks').all() as Row[])
      .map(row => stringValue(row.id))
      .filter(id => !incomingIds.has(id));
    return this.persistTrackChanges(tracks, staleIds, libraryRoot, scannedAt, 'full');
  }

  applyTrackDelta(delta: LibraryTrackDelta, libraryRoot: string, scannedAt: string) {
    const upserts = [...delta.added, ...delta.updated];
    const upsertIds = new Set(upserts.map(track => track.id));
    if (upsertIds.size !== upserts.length) {
      throw new Error('Delta de biblioteca inválido: faixa duplicada entre inclusões e atualizações.');
    }

    const removedIds = [...new Set(delta.removedIds)];
    if (removedIds.some(id => upsertIds.has(id))) {
      throw new Error('Delta de biblioteca inválido: a mesma faixa não pode ser atualizada e removida.');
    }

    return this.persistTrackChanges(upserts, removedIds, libraryRoot, scannedAt, 'delta');
  }

  getFavoriteIds(userId: string) {
    requireUserId(userId);
    return (this.db.prepare(`
      SELECT track_id
      FROM favorites
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId) as Row[]).map(row => stringValue(row.track_id));
  }

  setFavorite(userId: string, trackId: string, favorite: boolean) {
    requireUserId(userId);
    if (favorite) {
      this.db.prepare(`
        INSERT INTO favorites(user_id, track_id, created_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id, track_id) DO NOTHING
      `).run(userId, trackId, new Date().toISOString());
      return;
    }

    this.db.prepare('DELETE FROM favorites WHERE user_id = ? AND track_id = ?')
      .run(userId, trackId);
  }

  recordHistory(userId: string, trackId: string, playedAt = new Date().toISOString()) {
    requireUserId(userId);
    this.db.prepare('INSERT INTO history(user_id, track_id, played_at) VALUES (?, ?, ?)')
      .run(userId, trackId, playedAt);
    this.db.prepare(`
      DELETE FROM history
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id
          FROM history
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT ${HISTORY_CAPACITY}
        )
    `).run(userId, userId);
  }

  getHistory(userId: string, limit = 200) {
    requireUserId(userId);
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db.prepare(`
      SELECT h.id AS history_id, h.played_at,
             t.id, t.title, t.artist, t.album, t.album_artist, t.folder, t.folder_path,
             t.duration, t.format, t.has_cover,
             t.replaygain_track_db, t.replaygain_album_db
      FROM history h
      JOIN tracks t ON t.id = h.track_id
      WHERE h.user_id = ?
      ORDER BY h.id DESC
      LIMIT ?
    `).all(userId, safeLimit) as Row[];

    return rows.map(row => ({
      id: numberValue(row.history_id),
      playedAt: stringValue(row.played_at),
      track: publicTrackFromRow(row)
    }));
  }

  clearHistory(userId: string) {
    requireUserId(userId);
    this.db.prepare('DELETE FROM history WHERE user_id = ?;').run(userId);
  }

  getStatistics(userId: string, period: StatisticsPeriod, now = new Date()) {
    requireUserId(userId);
    const days = period === '7d' ? 7 : period === '30d' ? 30 : null;
    const since = days == null
      ? null
      : new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString();
    const where = since ? 'WHERE h.user_id = ? AND h.played_at >= ?' : 'WHERE h.user_id = ?';
    const bindings = since ? [userId, since] : [userId];

    const summary = this.db.prepare(`
      SELECT COUNT(*) AS total_plays,
             COALESCE(SUM(COALESCE(t.duration, 0)), 0) AS total_seconds,
             COUNT(DISTINCT h.track_id) AS unique_tracks,
             COUNT(DISTINCT t.artist) AS unique_artists,
             MIN(h.played_at) AS first_played_at
      FROM history h
      JOIN tracks t ON t.id = h.track_id
      ${where}
    `).get(...bindings) as Row;

    const topTracks = (this.db.prepare(`
      SELECT t.id, t.title, t.artist, t.album, t.album_artist, t.folder, t.folder_path,
             t.duration, t.format, t.has_cover,
             t.replaygain_track_db, t.replaygain_album_db,
             COUNT(*) AS plays
      FROM history h
      JOIN tracks t ON t.id = h.track_id
      ${where}
      GROUP BY h.track_id
      ORDER BY plays DESC, MAX(h.id) DESC
      LIMIT 5
    `).all(...bindings) as Row[]).map(row => ({
      track: publicTrackFromRow(row),
      plays: numberValue(row.plays)
    }));

    const topArtists = (this.db.prepare(`
      SELECT t.artist, COUNT(*) AS plays
      FROM history h
      JOIN tracks t ON t.id = h.track_id
      ${where}
      GROUP BY t.artist
      ORDER BY plays DESC, t.artist COLLATE NOCASE
      LIMIT 5
    `).all(...bindings) as Row[]).map(row => ({
      artist: stringValue(row.artist, 'Artista desconhecido'),
      plays: numberValue(row.plays)
    }));

    const topAlbums = (this.db.prepare(`
      SELECT t.album, t.album_artist, COUNT(*) AS plays
      FROM history h
      JOIN tracks t ON t.id = h.track_id
      ${where}
      GROUP BY t.album_artist, t.album
      ORDER BY plays DESC, t.album COLLATE NOCASE
      LIMIT 5
    `).all(...bindings) as Row[]).map(row => ({
      album: stringValue(row.album, 'Álbum desconhecido'),
      albumArtist: stringValue(row.album_artist, 'Artista desconhecido'),
      plays: numberValue(row.plays)
    }));

    return {
      period,
      generatedAt: now.toISOString(),
      firstPlayedAt: typeof summary.first_played_at === 'string' ? summary.first_played_at : null,
      totalPlays: numberValue(summary.total_plays),
      totalMinutes: Math.round(numberValue(summary.total_seconds) / 60),
      uniqueTracks: numberValue(summary.unique_tracks),
      uniqueArtists: numberValue(summary.unique_artists),
      topTracks,
      topArtists,
      topAlbums,
      historyCapacity: HISTORY_CAPACITY
    };
  }

  getPlaylists(userId: string): Playlist[] {
    requireUserId(userId);
    const playlists = this.db.prepare(`
      SELECT id, name, created_at, updated_at, source
      FROM playlists
      WHERE source = 'rekordbox'
         OR (source = 'manual' AND owner_user_id = ?)
      ORDER BY updated_at DESC, name COLLATE NOCASE
    `).all(userId) as Row[];
    const tracksStatement = this.db.prepare(`
      SELECT pt.track_id
      FROM playlist_tracks pt
      JOIN playlists p ON p.id = pt.playlist_id
      WHERE pt.playlist_id = ?
        AND (
          p.source = 'rekordbox'
          OR (p.source = 'manual' AND p.owner_user_id = ?)
        )
      ORDER BY pt.position
    `);

    return playlists.map(row => ({
      id: stringValue(row.id),
      name: stringValue(row.name),
      trackIds: (tracksStatement.all(stringValue(row.id), userId) as Row[])
        .map(item => stringValue(item.track_id)),
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at),
      source: playlistSourceValue(row.source)
    }));
  }

  getPlaylistSource(userId: string, id: string): PlaylistSource | null {
    requireUserId(userId);
    const row = this.db.prepare(`
      SELECT source
      FROM playlists
      WHERE id = ?
        AND (source = 'rekordbox' OR (source = 'manual' AND owner_user_id = ?))
    `).get(id, userId) as Row | undefined;
    return row ? playlistSourceValue(row.source) : null;
  }

  createPlaylist(userId: string, name: string) {
    requireUserId(userId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
      VALUES (?, ?, ?, ?, 'manual', NULL, ?)
    `).run(id, name, now, now, userId);
    return id;
  }

  renamePlaylist(userId: string, id: string, name: string) {
    requireUserId(userId);
    const result = this.db.prepare(`
      UPDATE playlists
      SET name = ?, updated_at = ?
      WHERE id = ? AND source = 'manual' AND owner_user_id = ?
    `).run(name, new Date().toISOString(), id, userId);
    return result.changes > 0;
  }

  deletePlaylist(userId: string, id: string) {
    requireUserId(userId);
    const result = this.db.prepare(`
      DELETE FROM playlists
      WHERE id = ? AND source = 'manual' AND owner_user_id = ?
    `).run(id, userId);
    return result.changes > 0;
  }

  setPlaylistTracks(userId: string, id: string, trackIds: string[]) {
    requireUserId(userId);
    const uniqueIds = [...new Set(trackIds)];
    const remove = this.db.prepare(`
      DELETE FROM playlist_tracks
      WHERE playlist_id = ?
        AND EXISTS (
          SELECT 1
          FROM playlists p
          WHERE p.id = playlist_tracks.playlist_id
            AND p.source = 'manual'
            AND p.owner_user_id = ?
        )
    `);
    const insert = this.db.prepare(`
      INSERT INTO playlist_tracks(playlist_id, track_id, position)
      SELECT p.id, ?, ?
      FROM playlists p
      WHERE p.id = ?
        AND p.source = 'manual'
        AND p.owner_user_id = ?
    `);
    const touch = this.db.prepare(`
      UPDATE playlists
      SET updated_at = ?
      WHERE id = ? AND source = 'manual' AND owner_user_id = ?
    `);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const touched = touch.run(new Date().toISOString(), id, userId);
      if (Number(touched.changes) !== 1) {
        this.db.exec('ROLLBACK;');
        return false;
      }

      remove.run(id, userId);
      for (const [index, trackId] of uniqueIds.entries()) {
        const inserted = insert.run(trackId, index, id, userId);
        if (Number(inserted.changes) !== 1) {
          throw new Error('Playlist manual saiu do escopo de ownership durante a atualização.');
        }
      }

      this.db.exec('COMMIT;');
      return true;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserva o erro original se a transação já tiver sido encerrada.
      }
      throw error;
    }
  }

  syncImportedPlaylists(source: 'rekordbox', playlists: ImportedPlaylist[]) {
    const bySourceKey = new Map<string, ImportedPlaylist>();
    for (const playlist of playlists) {
      const sourceKey = playlist.sourceKey.trim();
      if (!sourceKey) continue;
      bySourceKey.set(sourceKey, {
        sourceKey,
        name: playlist.name.trim().slice(0, 120) || 'Playlist Rekordbox',
        trackIds: [...new Set(playlist.trackIds)]
      });
    }

    const existingRows = this.db.prepare(`
      SELECT id, source_key
      FROM playlists
      WHERE source = ? AND owner_user_id IS NULL AND source_key IS NOT NULL
    `).all(source) as Row[];
    const existing = new Map(existingRows.map(row => [stringValue(row.source_key), stringValue(row.id)]));
    const removeTracks = this.db.prepare(`
      DELETE FROM playlist_tracks
      WHERE playlist_id = ?
        AND EXISTS (
          SELECT 1
          FROM playlists p
          WHERE p.id = playlist_tracks.playlist_id
            AND p.source = ?
            AND p.owner_user_id IS NULL
        )
    `);
    const insertTrack = this.db.prepare(`
      INSERT INTO playlist_tracks(playlist_id, track_id, position)
      SELECT p.id, ?, ?
      FROM playlists p
      WHERE p.id = ? AND p.source = ? AND p.owner_user_id IS NULL
    `);
    const insertPlaylist = this.db.prepare(`
      INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `);
    const updatePlaylist = this.db.prepare(`
      UPDATE playlists
      SET name = ?, updated_at = ?
      WHERE id = ? AND source = ? AND owner_user_id IS NULL
    `);
    const now = new Date().toISOString();
    let createdPlaylists = 0;
    let updatedPlaylists = 0;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const playlist of bySourceKey.values()) {
        let id = existing.get(playlist.sourceKey);
        if (id) {
          const updated = updatePlaylist.run(playlist.name, now, id, source);
          if (Number(updated.changes) !== 1) {
            throw new Error('Playlist Rekordbox saiu do escopo compartilhado durante a sincronização.');
          }
          updatedPlaylists += 1;
        } else {
          id = randomUUID();
          insertPlaylist.run(id, playlist.name, now, now, source, playlist.sourceKey);
          createdPlaylists += 1;
        }

        removeTracks.run(id, source);
        for (const [index, trackId] of playlist.trackIds.entries()) {
          const inserted = insertTrack.run(trackId, index, id, source);
          if (Number(inserted.changes) !== 1) {
            throw new Error('Playlist Rekordbox saiu do escopo compartilhado durante a sincronização.');
          }
        }
      }

      this.db.exec('COMMIT;');
      return { createdPlaylists, updatedPlaylists, removedPlaylists: 0 };
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  loadPlaybackState(userId: string): PlaybackState {
    requireUserId(userId);
    const row = this.db.prepare(`
      SELECT current_track_id, position, volume, shuffle, repeat_mode, was_playing,
             base_queue_json, queue_json, updated_at
      FROM playback_state
      WHERE user_id = ?
    `).get(userId) as Row | undefined;

    if (!row) return { ...DEFAULT_PLAYBACK_STATE };

    return {
      currentTrackId: typeof row.current_track_id === 'string' ? row.current_track_id : null,
      position: Math.max(0, numberValue(row.position)),
      volume: Math.max(0, Math.min(1, numberValue(row.volume, 1))),
      shuffle: Boolean(row.shuffle),
      repeatMode: repeatModeValue(row.repeat_mode),
      wasPlaying: Boolean(row.was_playing),
      baseQueueIds: stringArrayValue(row.base_queue_json),
      queueIds: stringArrayValue(row.queue_json),
      updatedAt: stringValue(row.updated_at, new Date(0).toISOString())
    };
  }

  savePlaybackState(userId: string, state: Omit<PlaybackState, 'updatedAt'>) {
    requireUserId(userId);
    const updatedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO playback_state(
        user_id, current_track_id, position, volume, shuffle, repeat_mode, was_playing,
        base_queue_json, queue_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        current_track_id = excluded.current_track_id,
        position = excluded.position,
        volume = excluded.volume,
        shuffle = excluded.shuffle,
        repeat_mode = excluded.repeat_mode,
        was_playing = excluded.was_playing,
        base_queue_json = excluded.base_queue_json,
        queue_json = excluded.queue_json,
        updated_at = excluded.updated_at
    `).run(
      userId,
      state.currentTrackId,
      Math.max(0, state.position),
      Math.max(0, Math.min(1, state.volume)),
      state.shuffle ? 1 : 0,
      state.repeatMode,
      state.wasPlaying ? 1 : 0,
      JSON.stringify(state.baseQueueIds),
      JSON.stringify(state.queueIds),
      updatedAt
    );

    return { ...state, updatedAt } satisfies PlaybackState;
  }
}
