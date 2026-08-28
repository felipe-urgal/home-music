import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminTrackMetadataResponse,
  EditableTrackMetadata,
  Track,
  TrackMetadataOverride,
  TrackMetadataOverridePatch
} from '@home-music/shared';

const MAX_METADATA_LENGTH = 240;

type Row = Record<string, unknown>;

type StoredOverride = Omit<TrackMetadataOverride, 'updatedAt'> & {
  updatedAt: string;
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function editableMetadata(track: Pick<Track, 'title' | 'artist' | 'album' | 'albumArtist'>): EditableTrackMetadata {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist
  };
}

function overrideFromRow(row: Row): StoredOverride {
  return {
    title: nullableString(row.override_title),
    artist: nullableString(row.override_artist),
    album: nullableString(row.override_album),
    albumArtist: nullableString(row.override_album_artist),
    updatedAt: stringValue(row.override_updated_at)
  };
}

function emptyOverride(): TrackMetadataOverride {
  return {
    title: null,
    artist: null,
    album: null,
    albumArtist: null,
    updatedAt: null
  };
}

function effectiveMetadata(physical: EditableTrackMetadata, override: TrackMetadataOverride): EditableTrackMetadata {
  return {
    title: override.title ?? physical.title,
    artist: override.artist ?? physical.artist,
    album: override.album ?? physical.album,
    albumArtist: override.albumArtist ?? physical.albumArtist
  };
}

export function normalizeMetadataOverrideValue(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${field} inválido.`);
  const normalized = value.trim();
  if (!normalized) throw new RangeError(`${field} não pode ficar vazio.`);
  if (normalized.length > MAX_METADATA_LENGTH) {
    throw new RangeError(`${field} deve ter no máximo ${MAX_METADATA_LENGTH} caracteres.`);
  }
  return normalized;
}

export function normalizeMetadataOverridePatch(value: unknown): TrackMetadataOverridePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Metadados inválidos.');
  }

  const input = value as Record<string, unknown>;
  const allowed = new Set(['title', 'artist', 'album', 'albumArtist']);
  const unknown = Object.keys(input).filter(key => !allowed.has(key));
  if (unknown.length > 0) throw new TypeError(`Campo de metadados não suportado: ${unknown[0]}.`);

  const patch: TrackMetadataOverridePatch = {};
  if ('title' in input) patch.title = normalizeMetadataOverrideValue(input.title, 'Título');
  if ('artist' in input) patch.artist = normalizeMetadataOverrideValue(input.artist, 'Artista');
  if ('album' in input) patch.album = normalizeMetadataOverrideValue(input.album, 'Álbum');
  if ('albumArtist' in input) patch.albumArtist = normalizeMetadataOverrideValue(input.albumArtist, 'Artista do álbum');

  if (Object.keys(patch).length === 0) throw new TypeError('Informe ao menos um metadado para alterar.');
  return patch;
}

export class TrackMetadataOverrideStore {
  private readonly db: DatabaseSync;
  private overrides = new Map<string, StoredOverride>();

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS track_metadata_overrides (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        title TEXT CHECK(title IS NULL OR (length(trim(title)) BETWEEN 1 AND ${MAX_METADATA_LENGTH})),
        artist TEXT CHECK(artist IS NULL OR (length(trim(artist)) BETWEEN 1 AND ${MAX_METADATA_LENGTH})),
        album TEXT CHECK(album IS NULL OR (length(trim(album)) BETWEEN 1 AND ${MAX_METADATA_LENGTH})),
        album_artist TEXT CHECK(album_artist IS NULL OR (length(trim(album_artist)) BETWEEN 1 AND ${MAX_METADATA_LENGTH})),
        updated_at TEXT NOT NULL,
        CHECK(title IS NOT NULL OR artist IS NOT NULL OR album IS NOT NULL OR album_artist IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS idx_track_metadata_overrides_updated_at
      ON track_metadata_overrides(updated_at DESC);
    `);
    this.refresh();
  }

  close() {
    this.db.close();
  }

  refresh() {
    const rows = this.db.prepare(`
      SELECT track_id, title AS override_title, artist AS override_artist,
             album AS override_album, album_artist AS override_album_artist,
             updated_at AS override_updated_at
      FROM track_metadata_overrides;
    `).all() as Row[];

    this.overrides = new Map(rows.map(row => [stringValue(row.track_id), overrideFromRow(row)]));
  }

  hasOverride(trackId: string) {
    return this.overrides.has(trackId);
  }

  resolveTrack<T extends Track>(track: T): T {
    const override = this.overrides.get(track.id);
    if (!override) return track;
    return {
      ...track,
      ...effectiveMetadata(editableMetadata(track), override)
    };
  }

  get(trackId: string): AdminTrackMetadataResponse | null {
    const row = this.db.prepare(`
      SELECT t.id, t.title, t.artist, t.album, t.album_artist,
             o.title AS override_title, o.artist AS override_artist,
             o.album AS override_album, o.album_artist AS override_album_artist,
             o.updated_at AS override_updated_at
      FROM tracks t
      LEFT JOIN track_metadata_overrides o ON o.track_id = t.id
      WHERE t.id = ?
      LIMIT 1;
    `).get(trackId) as Row | undefined;
    if (!row) return null;

    const physical: EditableTrackMetadata = {
      title: stringValue(row.title),
      artist: stringValue(row.artist),
      album: stringValue(row.album),
      albumArtist: stringValue(row.album_artist)
    };
    const override = row.override_updated_at == null ? emptyOverride() : overrideFromRow(row);

    return {
      trackId: stringValue(row.id),
      physical,
      override,
      effective: effectiveMetadata(physical, override)
    };
  }

  patch(trackId: string, patch: TrackMetadataOverridePatch): AdminTrackMetadataResponse | null {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const physicalRow = this.db.prepare(`
        SELECT title, artist, album, album_artist
        FROM tracks
        WHERE id = ?
        LIMIT 1;
      `).get(trackId) as Row | undefined;
      if (!physicalRow) {
        this.db.exec('ROLLBACK;');
        return null;
      }

      const currentRow = this.db.prepare(`
        SELECT title AS override_title, artist AS override_artist,
               album AS override_album, album_artist AS override_album_artist,
               updated_at AS override_updated_at
        FROM track_metadata_overrides
        WHERE track_id = ?
        LIMIT 1;
      `).get(trackId) as Row | undefined;
      const current = currentRow ? overrideFromRow(currentRow) : {
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        updatedAt: new Date(0).toISOString()
      };
      const physical: EditableTrackMetadata = {
        title: stringValue(physicalRow.title),
        artist: stringValue(physicalRow.artist),
        album: stringValue(physicalRow.album),
        albumArtist: stringValue(physicalRow.album_artist)
      };

      const next = {
        title: patch.title !== undefined ? patch.title : current.title,
        artist: patch.artist !== undefined ? patch.artist : current.artist,
        album: patch.album !== undefined ? patch.album : current.album,
        albumArtist: patch.albumArtist !== undefined ? patch.albumArtist : current.albumArtist
      };

      if (next.title === physical.title) next.title = null;
      if (next.artist === physical.artist) next.artist = null;
      if (next.album === physical.album) next.album = null;
      if (next.albumArtist === physical.albumArtist) next.albumArtist = null;

      if (next.title == null && next.artist == null && next.album == null && next.albumArtist == null) {
        this.db.prepare('DELETE FROM track_metadata_overrides WHERE track_id = ?;').run(trackId);
      } else {
        const updatedAt = new Date().toISOString();
        this.db.prepare(`
          INSERT INTO track_metadata_overrides(track_id, title, artist, album, album_artist, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(track_id) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            album_artist = excluded.album_artist,
            updated_at = excluded.updated_at;
        `).run(trackId, next.title, next.artist, next.album, next.albumArtist, updatedAt);
      }

      this.db.exec('COMMIT;');
      this.refresh();
      return this.get(trackId);
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  clear(trackId: string): AdminTrackMetadataResponse | null {
    const exists = Boolean(this.db.prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1;').get(trackId));
    if (!exists) return null;
    this.db.prepare('DELETE FROM track_metadata_overrides WHERE track_id = ?;').run(trackId);
    this.refresh();
    return this.get(trackId);
  }
}
