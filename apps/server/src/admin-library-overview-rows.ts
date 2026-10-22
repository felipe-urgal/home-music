import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, unknown>;

export type AdminLibraryOverviewRows = {
  metadataRows: Row[];
  coverRows: Row[];
  hiddenRows: Row[];
};

/** A single read path for the main SQLite owner and the read-only fallback. */
export function readAdminLibraryOverviewRows(db: DatabaseSync): AdminLibraryOverviewRows {
  return {
    metadataRows: db.prepare(`
      SELECT track_id, title, artist, album, album_artist
      FROM track_metadata_overrides;
    `).all() as Row[],
    coverRows: db.prepare('SELECT track_id FROM track_cover_overrides;').all() as Row[],
    hiddenRows: db.prepare('SELECT track_id FROM media_quarantine;').all() as Row[]
  };
}
