import { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

export class TrackAvailabilityStore {
  private readonly db: DatabaseSync;
  private disabledTrackIds = new Set<string>();

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS track_availability (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
      );
    `);
    this.refresh();
  }

  close() {
    this.db.close();
  }

  refresh() {
    const rows = this.db.prepare(`
      SELECT track_id
      FROM track_availability
      WHERE enabled = 0;
    `).all() as Row[];
    this.disabledTrackIds = new Set(
      rows
        .map(row => typeof row.track_id === 'string' ? row.track_id : '')
        .filter(Boolean)
    );
  }

  isEnabled(trackId: string) {
    return !this.disabledTrackIds.has(trackId);
  }

  setEnabled(trackId: string, enabled: boolean) {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const exists = Boolean(this.db.prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1;').get(trackId));
      if (!exists) {
        this.db.prepare('DELETE FROM track_availability WHERE track_id = ?;').run(trackId);
        this.db.exec('COMMIT;');
        this.disabledTrackIds.delete(trackId);
        return false;
      }

      if (enabled) {
        this.db.prepare('DELETE FROM track_availability WHERE track_id = ?;').run(trackId);
        this.db.exec('COMMIT;');
        this.disabledTrackIds.delete(trackId);
        return true;
      }

      this.db.prepare(`
        INSERT INTO track_availability(track_id, enabled)
        VALUES (?, 0)
        ON CONFLICT(track_id) DO UPDATE SET enabled = 0;
      `).run(trackId);
      this.db.exec('COMMIT;');
      this.disabledTrackIds.add(trackId);
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
}
