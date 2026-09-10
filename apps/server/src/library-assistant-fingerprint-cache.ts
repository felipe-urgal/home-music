import { DatabaseSync } from 'node:sqlite';

const MAX_CACHE_ENTRIES = 2_000;
const MAX_FINGERPRINT_CHARS = 64 * 1024;

type Row = Record<string, unknown>;

export type CachedAudioFingerprint = {
  signature: string;
  durationSeconds: number;
  fingerprint: string;
};

export class LibraryAssistantFingerprintCache {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_assistant_fingerprint_cache (
        track_id TEXT PRIMARY KEY NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        file_signature TEXT NOT NULL CHECK(length(file_signature) = 64),
        duration_seconds INTEGER NOT NULL CHECK(duration_seconds > 0 AND duration_seconds <= 86400),
        fingerprint TEXT NOT NULL CHECK(length(fingerprint) BETWEEN 1 AND ${MAX_FINGERPRINT_CHARS}),
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_library_assistant_fingerprint_cache_updated
      ON library_assistant_fingerprint_cache(updated_at DESC);
    `);
  }

  close() {
    this.db.close();
  }

  get(trackId: string, signature: string): CachedAudioFingerprint | null {
    const row = this.db.prepare(`
      SELECT file_signature, duration_seconds, fingerprint
      FROM library_assistant_fingerprint_cache
      WHERE track_id = ? AND file_signature = ?
      LIMIT 1;
    `).get(trackId, signature) as Row | undefined;
    if (!row) return null;
    const durationSeconds = Number(row.duration_seconds);
    const fingerprint = typeof row.fingerprint === 'string' ? row.fingerprint : '';
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0 || !fingerprint) return null;
    return { signature, durationSeconds, fingerprint };
  }

  put(trackId: string, value: CachedAudioFingerprint, updatedAt = new Date().toISOString()) {
    if (!/^[a-f0-9]{64}$/.test(value.signature)) throw new TypeError('Assinatura de fingerprint inválida.');
    if (!Number.isSafeInteger(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 86400) {
      throw new RangeError('Duração de fingerprint inválida.');
    }
    if (!value.fingerprint || value.fingerprint.length > MAX_FINGERPRINT_CHARS) {
      throw new RangeError('Fingerprint excede o limite local.');
    }
    this.db.prepare(`
      INSERT INTO library_assistant_fingerprint_cache(
        track_id, file_signature, duration_seconds, fingerprint, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(track_id) DO UPDATE SET
        file_signature = excluded.file_signature,
        duration_seconds = excluded.duration_seconds,
        fingerprint = excluded.fingerprint,
        updated_at = excluded.updated_at;
    `).run(trackId, value.signature, value.durationSeconds, value.fingerprint, updatedAt);
    this.db.prepare(`
      DELETE FROM library_assistant_fingerprint_cache
      WHERE track_id IN (
        SELECT track_id FROM library_assistant_fingerprint_cache
        ORDER BY updated_at DESC, track_id DESC
        LIMIT -1 OFFSET ?
      );
    `).run(MAX_CACHE_ENTRIES);
  }
}
