import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Playlist, SmartPlaylistRule } from '@home-music/shared';

const MAX_FILTER_LENGTH = 160;
const MAX_FOLDER_LENGTH = 512;
const MAX_RULE_LIMIT = 500;
const MAX_PERIOD_DAYS = 3650;

type Row = Record<string, unknown>;

type EvaluatedTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  folderPath: string;
  plays: number;
  lastPlayedAt: string | null;
  hasPlayedEver: boolean;
  favoriteCreatedAt: string | null;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireUserId(userId: string) {
  if (!userId || userId.length > 128) throw new RangeError('userId pessoal inválido.');
}

function requirePlaylistId(id: string) {
  if (!id || id.length > 128) throw new RangeError('Playlist inteligente inválida.');
}

function normalizeTextFilter(value: unknown, maxLength = MAX_FILTER_LENGTH) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

function normalizeNullableBoolean(value: unknown) {
  if (value == null) return null;
  return typeof value === 'boolean' ? value : undefined;
}

function normalizePeriodDays(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_PERIOD_DAYS) return undefined;
  return number;
}

function normalizeLimit(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > MAX_RULE_LIMIT) return undefined;
  return number;
}

export function normalizeSmartPlaylistRule(value: unknown): SmartPlaylistRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const artist = normalizeTextFilter(input.artist);
  const album = normalizeTextFilter(input.album);
  const folderPath = normalizeTextFilter(input.folderPath, MAX_FOLDER_LENGTH);
  const favorite = normalizeNullableBoolean(input.favorite);
  const periodDays = normalizePeriodDays(input.periodDays);
  const limit = normalizeLimit(input.limit);
  const history = input.history;
  const sort = input.sort;

  if (
    artist === undefined
    || album === undefined
    || folderPath === undefined
    || favorite === undefined
    || periodDays === undefined
    || limit === undefined
    || (history !== 'any' && history !== 'played' && history !== 'never')
    || (sort !== 'most-played' && sort !== 'recently-played' && sort !== 'oldest-favorite' && sort !== 'title')
  ) {
    return null;
  }

  return {
    artist,
    album,
    folderPath,
    favorite,
    history,
    periodDays,
    sort,
    limit
  };
}

function normalizeComparable(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR');
}

function matchesText(value: string, filter: string | null) {
  return filter == null || normalizeComparable(value) === normalizeComparable(filter);
}

function matchesFolder(value: string, filter: string | null) {
  if (filter == null) return true;
  const current = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const requested = filter.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return current === requested || current.startsWith(`${requested}/`);
}

function compareNullableDateAsc(left: string | null, right: string | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.localeCompare(right);
}

function compareNullableDateDesc(left: string | null, right: string | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right.localeCompare(left);
}

function sortTracks(rule: SmartPlaylistRule, left: EvaluatedTrack, right: EvaluatedTrack) {
  switch (rule.sort) {
    case 'most-played':
      return right.plays - left.plays
        || compareNullableDateDesc(left.lastPlayedAt, right.lastPlayedAt)
        || left.artist.localeCompare(right.artist, 'pt-BR')
        || left.title.localeCompare(right.title, 'pt-BR');
    case 'recently-played':
      return compareNullableDateDesc(left.lastPlayedAt, right.lastPlayedAt)
        || right.plays - left.plays
        || left.artist.localeCompare(right.artist, 'pt-BR')
        || left.title.localeCompare(right.title, 'pt-BR');
    case 'oldest-favorite':
      return compareNullableDateAsc(left.favoriteCreatedAt, right.favoriteCreatedAt)
        || left.artist.localeCompare(right.artist, 'pt-BR')
        || left.title.localeCompare(right.title, 'pt-BR');
    case 'title':
      return left.artist.localeCompare(right.artist, 'pt-BR')
        || left.title.localeCompare(right.title, 'pt-BR');
  }
}

function parseStoredRule(value: unknown): SmartPlaylistRule | null {
  if (typeof value !== 'string') return null;
  try {
    return normalizeSmartPlaylistRule(JSON.parse(value));
  } catch {
    return null;
  }
}

export class SmartPlaylistStore {
  private readonly db: DatabaseSync;
  private readonly hasTrackAvailability: boolean;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_playlists (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
        rule_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_smart_playlists_owner_updated
      ON smart_playlists(owner_user_id, updated_at DESC, id ASC);
    `);
    this.hasTrackAvailability = Boolean(this.db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = 'track_availability'
      LIMIT 1
    `).get());
  }

  close() {
    this.db.close();
  }

  evaluate(
    userId: string,
    rule: SmartPlaylistRule,
    eligibleTrackIds?: ReadonlySet<string>,
    now = new Date()
  ) {
    requireUserId(userId);
    const normalizedRule = normalizeSmartPlaylistRule(rule);
    if (!normalizedRule) throw new RangeError('Regra da playlist inteligente inválida.');
    const since = normalizedRule.periodDays == null
      ? null
      : new Date(now.getTime() - normalizedRule.periodDays * 24 * 60 * 60 * 1_000).toISOString();
    const scopedWhere = since ? 'AND played_at >= ?' : '';
    const bindings: string[] = [userId];
    if (since) bindings.push(since);
    bindings.push(userId, userId);
    const availabilityJoin = this.hasTrackAvailability
      ? 'LEFT JOIN track_availability ta ON ta.track_id = t.id'
      : '';
    const availabilityWhere = this.hasTrackAvailability
      ? 'WHERE COALESCE(ta.enabled, 1) = 1'
      : '';

    const rows = this.db.prepare(`
      WITH scoped_history AS (
        SELECT track_id, COUNT(*) AS plays, MAX(played_at) AS last_played_at
        FROM history
        WHERE user_id = ? ${scopedWhere}
        GROUP BY track_id
      ),
      all_history AS (
        SELECT track_id, 1 AS has_played_ever
        FROM history
        WHERE user_id = ?
        GROUP BY track_id
      ),
      user_favorites AS (
        SELECT track_id, created_at AS favorite_created_at
        FROM favorites
        WHERE user_id = ?
      )
      SELECT t.id, t.title, t.artist, t.album, t.folder_path,
             COALESCE(sh.plays, 0) AS plays,
             sh.last_played_at,
             COALESCE(ah.has_played_ever, 0) AS has_played_ever,
             uf.favorite_created_at
      FROM tracks t
      LEFT JOIN scoped_history sh ON sh.track_id = t.id
      LEFT JOIN all_history ah ON ah.track_id = t.id
      LEFT JOIN user_favorites uf ON uf.track_id = t.id
      ${availabilityJoin}
      ${availabilityWhere}
    `).all(...bindings) as Row[];

    return rows
      .map(row => ({
        id: stringValue(row.id),
        title: stringValue(row.title),
        artist: stringValue(row.artist),
        album: stringValue(row.album),
        folderPath: stringValue(row.folder_path),
        plays: numberValue(row.plays),
        lastPlayedAt: typeof row.last_played_at === 'string' ? row.last_played_at : null,
        hasPlayedEver: Boolean(row.has_played_ever),
        favoriteCreatedAt: typeof row.favorite_created_at === 'string' ? row.favorite_created_at : null
      }))
      .filter(track => !eligibleTrackIds || eligibleTrackIds.has(track.id))
      .filter(track => matchesText(track.artist, normalizedRule.artist))
      .filter(track => matchesText(track.album, normalizedRule.album))
      .filter(track => matchesFolder(track.folderPath, normalizedRule.folderPath))
      .filter(track => {
        if (normalizedRule.favorite == null) return true;
        return normalizedRule.favorite === Boolean(track.favoriteCreatedAt);
      })
      .filter(track => {
        if (normalizedRule.history === 'any') return true;
        if (normalizedRule.history === 'never') return !track.hasPlayedEver;
        return track.plays > 0;
      })
      .sort((left, right) => sortTracks(normalizedRule, left, right))
      .slice(0, normalizedRule.limit)
      .map(track => track.id);
  }

  list(userId: string, eligibleTrackIds?: ReadonlySet<string>, now = new Date()): Playlist[] {
    requireUserId(userId);
    const rows = this.db.prepare(`
      SELECT id, name, rule_json, created_at, updated_at
      FROM smart_playlists
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC, name COLLATE NOCASE, id ASC
    `).all(userId) as Row[];

    const playlists: Playlist[] = [];
    for (const row of rows) {
      const rule = parseStoredRule(row.rule_json);
      if (!rule) continue;
      playlists.push({
        id: stringValue(row.id),
        name: stringValue(row.name),
        trackIds: this.evaluate(userId, rule, eligibleTrackIds, now),
        createdAt: stringValue(row.created_at),
        updatedAt: stringValue(row.updated_at),
        source: 'smart',
        rule
      });
    }
    return playlists;
  }

  get(userId: string, id: string, eligibleTrackIds?: ReadonlySet<string>, now = new Date()) {
    requireUserId(userId);
    requirePlaylistId(id);
    const row = this.db.prepare(`
      SELECT id, name, rule_json, created_at, updated_at
      FROM smart_playlists
      WHERE id = ? AND owner_user_id = ?
    `).get(id, userId) as Row | undefined;
    if (!row) return null;
    const rule = parseStoredRule(row.rule_json);
    if (!rule) return null;
    return {
      id: stringValue(row.id),
      name: stringValue(row.name),
      trackIds: this.evaluate(userId, rule, eligibleTrackIds, now),
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at),
      source: 'smart',
      rule
    } satisfies Playlist;
  }

  create(userId: string, name: string, rule: SmartPlaylistRule) {
    requireUserId(userId);
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 120) throw new RangeError('Nome da playlist inteligente inválido.');
    const normalizedRule = normalizeSmartPlaylistRule(rule);
    if (!normalizedRule) throw new RangeError('Regra da playlist inteligente inválida.');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO smart_playlists(id, owner_user_id, name, rule_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, cleanName, JSON.stringify(normalizedRule), now, now);
    return id;
  }

  update(userId: string, id: string, patch: { name?: string; rule?: SmartPlaylistRule }) {
    requireUserId(userId);
    requirePlaylistId(id);
    const current = this.db.prepare(`
      SELECT name, rule_json
      FROM smart_playlists
      WHERE id = ? AND owner_user_id = ?
    `).get(id, userId) as Row | undefined;
    if (!current) return false;

    const currentRule = parseStoredRule(current.rule_json);
    if (!currentRule) return false;
    const name = patch.name == null ? stringValue(current.name) : patch.name.trim();
    if (!name || name.length > 120) throw new RangeError('Nome da playlist inteligente inválido.');
    const rule = patch.rule == null ? currentRule : normalizeSmartPlaylistRule(patch.rule);
    if (!rule) throw new RangeError('Regra da playlist inteligente inválida.');
    const result = this.db.prepare(`
      UPDATE smart_playlists
      SET name = ?, rule_json = ?, updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).run(name, JSON.stringify(rule), new Date().toISOString(), id, userId);
    return Number(result.changes) === 1;
  }

  delete(userId: string, id: string) {
    requireUserId(userId);
    requirePlaylistId(id);
    const result = this.db.prepare(`
      DELETE FROM smart_playlists
      WHERE id = ? AND owner_user_id = ?
    `).run(id, userId);
    return Number(result.changes) === 1;
  }
}
