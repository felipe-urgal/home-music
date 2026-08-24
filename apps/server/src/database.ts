import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PlaybackState, Playlist, RepeatMode, Track } from '@home-music/shared';
import type { IndexedTrack } from './library.js';

const CURRENT_SCHEMA_VERSION = 2;

const DEFAULT_PLAYBACK_STATE: PlaybackState = {
  currentTrackId: null,
  position: 0,
  volume: 1,
  shuffle: false,
  repeatMode: 'off',
  baseQueueIds: [],
  queueIds: [],
  updatedAt: new Date(0).toISOString()
};

type Row = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function repeatModeValue(value: unknown): RepeatMode {
  return value === 'one' || value === 'all' ? value : 'off';
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
    hasCover: Boolean(row.has_cover)
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

  loadTracks(): IndexedTrack[] {
    const rows = this.db.prepare(`
      SELECT id, file_path, title, artist, album, album_artist, folder, folder_path,
             duration, format, has_cover, mime_type, file_size, mtime_ms
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
    const existing = new Set(
      (this.db.prepare('SELECT id FROM tracks').all() as Row[]).map(row => stringValue(row.id))
    );

    const upsert = this.db.prepare(`
      INSERT INTO tracks(
        id, file_path, title, artist, album, album_artist, folder, folder_path,
        duration, format, has_cover, mime_type, file_size, mtime_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        mime_type = excluded.mime_type,
        file_size = excluded.file_size,
        mtime_ms = excluded.mtime_ms
    `);
    const remove = this.db.prepare('DELETE FROM tracks WHERE id = ?');

    this.db.exec('BEGIN IMMEDIATE;');
    try {
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
          track.mimeType,
          track.fileSize,
          track.mtimeMs
        );
        existing.delete(track.id);
      }

      for (const staleId of existing) remove.run(staleId);
      this.setMetadata('libraryRoot', libraryRoot);
      this.setMetadata('scannedAt', scannedAt);
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  getFavoriteIds() {
    return (this.db.prepare('SELECT track_id FROM favorites ORDER BY created_at DESC').all() as Row[])
      .map(row => stringValue(row.track_id));
  }

  setFavorite(trackId: string, favorite: boolean) {
    if (favorite) {
      this.db.prepare(`
        INSERT INTO favorites(track_id, created_at) VALUES (?, ?)
        ON CONFLICT(track_id) DO NOTHING
      `).run(trackId, new Date().toISOString());
      return;
    }

    this.db.prepare('DELETE FROM favorites WHERE track_id = ?').run(trackId);
  }

  recordHistory(trackId: string) {
    this.db.prepare('INSERT INTO history(track_id, played_at) VALUES (?, ?)')
      .run(trackId, new Date().toISOString());
    this.db.exec(`
      DELETE FROM history
      WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 2000)
    `);
  }

  getHistory(limit = 200) {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db.prepare(`
      SELECT h.id AS history_id, h.played_at,
             t.id, t.title, t.artist, t.album, t.album_artist, t.folder, t.folder_path,
             t.duration, t.format, t.has_cover
      FROM history h
      JOIN tracks t ON t.id = h.track_id
      ORDER BY h.id DESC
      LIMIT ?
    `).all(safeLimit) as Row[];

    return rows.map(row => ({
      id: numberValue(row.history_id),
      playedAt: stringValue(row.played_at),
      track: publicTrackFromRow(row)
    }));
  }

  clearHistory() {
    this.db.exec('DELETE FROM history;');
  }

  getPlaylists(): Playlist[] {
    const playlists = this.db.prepare(`
      SELECT id, name, created_at, updated_at
      FROM playlists
      ORDER BY updated_at DESC, name COLLATE NOCASE
    `).all() as Row[];
    const tracksStatement = this.db.prepare(`
      SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position
    `);

    return playlists.map(row => ({
      id: stringValue(row.id),
      name: stringValue(row.name),
      trackIds: (tracksStatement.all(stringValue(row.id)) as Row[]).map(item => stringValue(item.track_id)),
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at)
    }));
  }

  createPlaylist(name: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO playlists(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, name, now, now);
    return id;
  }

  renamePlaylist(id: string, name: string) {
    const result = this.db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, new Date().toISOString(), id);
    return result.changes > 0;
  }

  deletePlaylist(id: string) {
    const result = this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    return result.changes > 0;
  }

  setPlaylistTracks(id: string, trackIds: string[]) {
    const uniqueIds = [...new Set(trackIds)];
    const exists = this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id);
    if (!exists) return false;

    const remove = this.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?');
    const insert = this.db.prepare(`
      INSERT INTO playlist_tracks(playlist_id, track_id, position) VALUES (?, ?, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      remove.run(id);
      uniqueIds.forEach((trackId, index) => insert.run(id, trackId, index));
      this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
      this.db.exec('COMMIT;');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  loadPlaybackState(): PlaybackState {
    const row = this.db.prepare(`
      SELECT current_track_id, position, volume, shuffle, repeat_mode,
             base_queue_json, queue_json, updated_at
      FROM playback_state WHERE id = 1
    `).get() as Row | undefined;

    if (!row) return DEFAULT_PLAYBACK_STATE;

    return {
      currentTrackId: typeof row.current_track_id === 'string' ? row.current_track_id : null,
      position: Math.max(0, numberValue(row.position)),
      volume: Math.max(0, Math.min(1, numberValue(row.volume, 1))),
      shuffle: Boolean(row.shuffle),
      repeatMode: repeatModeValue(row.repeat_mode),
      baseQueueIds: stringArrayValue(row.base_queue_json),
      queueIds: stringArrayValue(row.queue_json),
      updatedAt: stringValue(row.updated_at, new Date(0).toISOString())
    };
  }

  savePlaybackState(state: Omit<PlaybackState, 'updatedAt'>) {
    const updatedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO playback_state(
        id, current_track_id, position, volume, shuffle, repeat_mode,
        base_queue_json, queue_json, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_track_id = excluded.current_track_id,
        position = excluded.position,
        volume = excluded.volume,
        shuffle = excluded.shuffle,
        repeat_mode = excluded.repeat_mode,
        base_queue_json = excluded.base_queue_json,
        queue_json = excluded.queue_json,
        updated_at = excluded.updated_at
    `).run(
      state.currentTrackId,
      Math.max(0, state.position),
      Math.max(0, Math.min(1, state.volume)),
      state.shuffle ? 1 : 0,
      state.repeatMode,
      JSON.stringify(state.baseQueueIds),
      JSON.stringify(state.queueIds),
      updatedAt
    );

    return { ...state, updatedAt } satisfies PlaybackState;
  }
}
