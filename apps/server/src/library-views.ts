import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  LibraryViewCoverFilter,
  LibraryViewDefinition,
  LibraryViewSort,
  SavedLibraryView
} from '@home-music/shared';

type Row = Record<string, unknown>;

const MAX_NAME_LENGTH = 120;
const MAX_QUERY_LENGTH = 160;
const MAX_FORMAT_LENGTH = 64;
const MAX_USER_ID_LENGTH = 128;
const MAX_VIEW_ID_LENGTH = 128;

const VALID_SORTS = new Set<LibraryViewSort>([
  'current',
  'title-asc',
  'title-desc',
  'artist-asc',
  'artist-desc',
  'album-asc',
  'album-desc'
]);

const VALID_COVER_FILTERS = new Set<LibraryViewCoverFilter>([
  'all',
  'with-cover',
  'without-cover'
]);

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function requireUserId(userId: string) {
  if (!userId || userId.length > MAX_USER_ID_LENGTH) {
    throw new RangeError('userId pessoal inválido.');
  }
}

function requireViewId(id: string) {
  if (!id || id.length > MAX_VIEW_ID_LENGTH) {
    throw new RangeError('View inteligente inválida.');
  }
}

export function normalizeLibraryViewName(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_NAME_LENGTH ? normalized : null;
}

export function normalizeLibraryViewDefinition(value: unknown): LibraryViewDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.query !== 'string'
    || typeof input.format !== 'string'
    || typeof input.cover !== 'string'
    || typeof input.sort !== 'string'
  ) {
    return null;
  }

  const query = input.query.trim();
  const format = input.format.trim();
  const cover = input.cover as LibraryViewCoverFilter;
  const sort = input.sort as LibraryViewSort;

  if (
    query.length > MAX_QUERY_LENGTH
    || !format
    || format.length > MAX_FORMAT_LENGTH
    || !VALID_COVER_FILTERS.has(cover)
    || !VALID_SORTS.has(sort)
  ) {
    return null;
  }

  return { query, format, cover, sort };
}

function parseDefinition(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    return normalizeLibraryViewDefinition(JSON.parse(value));
  } catch {
    return null;
  }
}

function savedViewFromRow(row: Row): SavedLibraryView | null {
  const definition = parseDefinition(row.definition_json);
  if (!definition) return null;
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    definition,
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at)
  };
}

export class LibraryViewStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_views (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND ${MAX_NAME_LENGTH}),
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_library_views_owner_updated
      ON library_views(owner_user_id, updated_at DESC, name COLLATE NOCASE, id);
    `);
  }

  close() {
    this.db.close();
  }

  list(userId: string) {
    requireUserId(userId);
    const rows = this.db.prepare(`
      SELECT id, name, definition_json, created_at, updated_at
      FROM library_views
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC, name COLLATE NOCASE, id ASC;
    `).all(userId) as Row[];

    return rows
      .map(savedViewFromRow)
      .filter((view): view is SavedLibraryView => Boolean(view));
  }

  get(userId: string, id: string) {
    requireUserId(userId);
    requireViewId(id);
    const row = this.db.prepare(`
      SELECT id, name, definition_json, created_at, updated_at
      FROM library_views
      WHERE id = ? AND owner_user_id = ?;
    `).get(id, userId) as Row | undefined;
    return row ? savedViewFromRow(row) : null;
  }

  create(userId: string, name: string, definition: LibraryViewDefinition) {
    requireUserId(userId);
    const cleanName = normalizeLibraryViewName(name);
    const cleanDefinition = normalizeLibraryViewDefinition(definition);
    if (!cleanName) throw new RangeError('Nome da view inteligente inválido.');
    if (!cleanDefinition) throw new RangeError('Filtros da view inteligente inválidos.');

    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO library_views(
        id, owner_user_id, name, definition_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?);
    `).run(id, userId, cleanName, JSON.stringify(cleanDefinition), now, now);
    return id;
  }

  update(
    userId: string,
    id: string,
    patch: { name?: string; definition?: LibraryViewDefinition }
  ) {
    requireUserId(userId);
    requireViewId(id);

    const name = patch.name === undefined ? undefined : normalizeLibraryViewName(patch.name);
    const definition = patch.definition === undefined
      ? undefined
      : normalizeLibraryViewDefinition(patch.definition);
    if (patch.name !== undefined && !name) throw new RangeError('Nome da view inteligente inválido.');
    if (patch.definition !== undefined && !definition) {
      throw new RangeError('Filtros da view inteligente inválidos.');
    }
    if (name === undefined && definition === undefined) return false;

    const now = new Date().toISOString();
    let changes = 0;
    if (name !== undefined && definition !== undefined) {
      changes = Number(this.db.prepare(`
        UPDATE library_views
        SET name = ?, definition_json = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ?;
      `).run(name, JSON.stringify(definition), now, id, userId).changes);
    } else if (name !== undefined) {
      changes = Number(this.db.prepare(`
        UPDATE library_views
        SET name = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ?;
      `).run(name, now, id, userId).changes);
    } else if (definition !== undefined) {
      changes = Number(this.db.prepare(`
        UPDATE library_views
        SET definition_json = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ?;
      `).run(JSON.stringify(definition), now, id, userId).changes);
    }

    return changes === 1;
  }

  delete(userId: string, id: string) {
    requireUserId(userId);
    requireViewId(id);
    const result = this.db.prepare(`
      DELETE FROM library_views
      WHERE id = ? AND owner_user_id = ?;
    `).run(id, userId);
    return Number(result.changes) === 1;
  }
}
