import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MAX_MANAGED_LYRICS_BYTES = 48 * 1024;
const MAX_PROVIDER_LENGTH = 80;
const MAX_EXTERNAL_ID_LENGTH = 256;
const MAX_LANGUAGE_LENGTH = 32;

export type ManagedLyricsMode = 'plain' | 'synced';
export type ManagedLyricsOrigin = 'external' | 'manual' | 'generated';

export type TrackLyricsOverride = {
  trackId: string;
  mode: ManagedLyricsMode;
  text: string;
  origin: ManagedLyricsOrigin;
  provider: string | null;
  externalId: string | null;
  language: string | null;
  updatedAt: string;
};

type SaveLyricsOverride = Omit<TrackLyricsOverride, 'trackId' | 'updatedAt'>;
type SaveLyricsOverrideOptions = { preservePrevious?: boolean };
type Row = Record<string, unknown>;

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function validateOptional(value: string | null, maximum: number, label: string) {
  if (value == null) return;
  if (value.length > maximum || /[\r\n\t]/.test(value)) throw new TypeError(`${label} inválido.`);
}

function fromRow(row: Row): TrackLyricsOverride {
  const mode = row.mode === 'synced' ? 'synced' : 'plain';
  const origin = row.origin === 'manual' || row.origin === 'generated' ? row.origin : 'external';
  return {
    trackId: requiredText(row.track_id),
    mode,
    text: requiredText(row.content),
    origin,
    provider: optionalText(row.provider),
    externalId: optionalText(row.external_id),
    language: optionalText(row.language),
    updatedAt: requiredText(row.updated_at)
  };
}

export class TrackLyricsOverrideStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS track_lyrics_overrides (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('plain', 'synced')),
        content TEXT NOT NULL CHECK(length(CAST(content AS BLOB)) BETWEEN 1 AND ${MAX_MANAGED_LYRICS_BYTES}),
        origin TEXT NOT NULL CHECK(origin IN ('external', 'manual', 'generated')),
        provider TEXT,
        external_id TEXT,
        language TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_track_lyrics_overrides_updated_at
      ON track_lyrics_overrides(updated_at DESC);

      CREATE TABLE IF NOT EXISTS track_lyrics_override_history (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK(mode IN ('plain', 'synced')),
        content TEXT NOT NULL CHECK(length(CAST(content AS BLOB)) BETWEEN 1 AND ${MAX_MANAGED_LYRICS_BYTES}),
        origin TEXT NOT NULL CHECK(origin IN ('external', 'manual', 'generated')),
        provider TEXT,
        external_id TEXT,
        language TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  get(trackId: string): TrackLyricsOverride | null {
    const row = this.db.prepare(`
      SELECT track_id, mode, content, origin, provider, external_id, language, updated_at
      FROM track_lyrics_overrides
      WHERE track_id = ?
      LIMIT 1;
    `).get(trackId) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  save(
    trackId: string,
    input: SaveLyricsOverride,
    options: SaveLyricsOverrideOptions = {}
  ): TrackLyricsOverride | null {
    const text = input.text.replace(/^\uFEFF/, '').trim();
    if (!text) throw new RangeError('A letra gerenciada não pode ficar vazia.');
    if (Buffer.byteLength(text, 'utf8') > MAX_MANAGED_LYRICS_BYTES) {
      throw new RangeError(`A letra gerenciada deve ter no máximo ${MAX_MANAGED_LYRICS_BYTES} bytes.`);
    }
    if (input.mode !== 'plain' && input.mode !== 'synced') throw new TypeError('Modo de lyrics inválido.');
    if (!['external', 'manual', 'generated'].includes(input.origin)) throw new TypeError('Origem de lyrics inválida.');
    validateOptional(input.provider, MAX_PROVIDER_LENGTH, 'Provider');
    validateOptional(input.externalId, MAX_EXTERNAL_ID_LENGTH, 'Identificador externo');
    validateOptional(input.language, MAX_LANGUAGE_LENGTH, 'Idioma');

    const exists = this.db.prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1;').get(trackId);
    if (!exists) return null;
    const updatedAt = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      if (options.preservePrevious) {
        const current = this.db.prepare(`
          SELECT track_id, mode, content, origin, provider, external_id, language, updated_at
          FROM track_lyrics_overrides WHERE track_id = ? LIMIT 1;
        `).get(trackId) as Row | undefined;
        if (current) {
          this.db.prepare(`
            INSERT INTO track_lyrics_override_history(
              track_id, mode, content, origin, provider, external_id, language, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(track_id) DO UPDATE SET
              mode = excluded.mode,
              content = excluded.content,
              origin = excluded.origin,
              provider = excluded.provider,
              external_id = excluded.external_id,
              language = excluded.language,
              updated_at = excluded.updated_at;
          `).run(
            trackId,
            requiredText(current.mode),
            requiredText(current.content),
            requiredText(current.origin),
            current.provider ?? null,
            current.external_id ?? null,
            current.language ?? null,
            requiredText(current.updated_at)
          );
        } else {
          this.db.prepare('DELETE FROM track_lyrics_override_history WHERE track_id = ?;').run(trackId);
        }
      } else {
        this.db.prepare('DELETE FROM track_lyrics_override_history WHERE track_id = ?;').run(trackId);
      }

      this.db.prepare(`
        INSERT INTO track_lyrics_overrides(
          track_id, mode, content, origin, provider, external_id, language, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
          mode = excluded.mode,
          content = excluded.content,
          origin = excluded.origin,
          provider = excluded.provider,
          external_id = excluded.external_id,
          language = excluded.language,
          updated_at = excluded.updated_at;
      `).run(
        trackId,
        input.mode,
        text,
        input.origin,
        input.provider,
        input.externalId,
        input.language,
        updatedAt
      );
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
    return this.get(trackId);
  }

  clear(trackId: string) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const current = this.db.prepare('SELECT 1 FROM track_lyrics_overrides WHERE track_id = ? LIMIT 1;').get(trackId);
      if (!current) {
        this.db.prepare('DELETE FROM track_lyrics_override_history WHERE track_id = ?;').run(trackId);
        this.db.exec('COMMIT;');
        return false;
      }

      const previous = this.db.prepare(`
        SELECT track_id, mode, content, origin, provider, external_id, language, updated_at
        FROM track_lyrics_override_history WHERE track_id = ? LIMIT 1;
      `).get(trackId) as Row | undefined;

      if (previous) {
        this.db.prepare(`
          UPDATE track_lyrics_overrides
          SET mode = ?, content = ?, origin = ?, provider = ?, external_id = ?, language = ?, updated_at = ?
          WHERE track_id = ?;
        `).run(
          requiredText(previous.mode),
          requiredText(previous.content),
          requiredText(previous.origin),
          previous.provider ?? null,
          previous.external_id ?? null,
          previous.language ?? null,
          requiredText(previous.updated_at),
          trackId
        );
      } else {
        this.db.prepare('DELETE FROM track_lyrics_overrides WHERE track_id = ?;').run(trackId);
      }
      this.db.prepare('DELETE FROM track_lyrics_override_history WHERE track_id = ?;').run(trackId);
      this.db.exec('COMMIT;');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
}

let activeStore: TrackLyricsOverrideStore | null = null;

export function setActiveTrackLyricsOverrideStore(store: TrackLyricsOverrideStore | null) {
  activeStore = store;
}

export function getActiveTrackLyricsOverride(trackId: string) {
  return activeStore?.get(trackId) ?? null;
}
