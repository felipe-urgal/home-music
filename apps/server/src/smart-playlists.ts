import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Playlist, SmartPlaylistRule } from '@home-music/shared';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';

const MAX_FILTER_LENGTH = 160;
const MAX_FOLDER_LENGTH = 512;
const MAX_RULE_LIMIT = 500;
const MAX_PERIOD_DAYS = 3650;
const SMART_PLAYLIST_SOURCE = 'smart';
const SMART_RULE_VERSION = 1;

type Row = Record<string, unknown>;
type CanonicalMetadataByTrackId = ReturnType<LibraryMetadataNormalizationStore['canonicalMetadataByTrackId']>;

type SmartPlaylistTrackSnapshot = {
  id: string;
  title: string;
  artist: string;
  album: string;
  folderPath: string;
  normalizedArtist: string;
  normalizedAlbum: string;
  normalizedFolderPath: string;
  playedAt: string[];
  favoriteCreatedAt: string | null;
};

type EvaluatedTrack = {
  id: string;
  title: string;
  artist: string;
  plays: number;
  lastPlayedAt: string | null;
  favoriteCreatedAt: string | null;
};

type StoredSmartRule = {
  version: typeof SMART_RULE_VERSION;
  id: string;
  rule: SmartPlaylistRule;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
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

function normalizeFolderPath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function scopedHistory(playedAt: readonly string[], since: string | null) {
  if (since == null) {
    return {
      plays: playedAt.length,
      lastPlayedAt: playedAt[0] ?? null
    };
  }

  let plays = 0;
  for (const value of playedAt) {
    if (value < since) break;
    plays += 1;
  }
  return {
    plays,
    lastPlayedAt: plays > 0 ? playedAt[0] : null
  };
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

function encodeStoredRule(id: string, rule: SmartPlaylistRule) {
  return JSON.stringify({ version: SMART_RULE_VERSION, id, rule } satisfies StoredSmartRule);
}

function parseStoredRule(value: unknown, expectedId: string): SmartPlaylistRule | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredSmartRule>;
    if (parsed.version !== SMART_RULE_VERSION || parsed.id !== expectedId) return null;
    return normalizeSmartPlaylistRule(parsed.rule);
  } catch {
    return null;
  }
}

export class SmartPlaylistStore {
  private readonly db: DatabaseSync;
  private readonly normalization: LibraryMetadataNormalizationStore;
  private readonly hasTrackAvailability: boolean;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.normalization = new LibraryMetadataNormalizationStore(databasePath);
    this.hasTrackAvailability = Boolean(this.db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = 'track_availability'
      LIMIT 1
    `).get());
  }

  close() {
    this.normalization.close();
    this.db.close();
  }

  private loadEvaluationSnapshot(
    userId: string,
    canonicalMetadata: CanonicalMetadataByTrackId,
    eligibleTrackIds?: ReadonlySet<string>
  ) {
    requireUserId(userId);
    const availabilityJoin = this.hasTrackAvailability
      ? 'LEFT JOIN track_availability ta ON ta.track_id = t.id'
      : '';
    const availabilityWhere = this.hasTrackAvailability
      ? 'WHERE COALESCE(ta.enabled, 1) = 1'
      : '';

    const rows = this.db.prepare(`
      SELECT t.id, t.title, t.artist, t.album, t.folder_path,
             uf.created_at AS favorite_created_at
      FROM tracks t
      LEFT JOIN favorites uf
        ON uf.track_id = t.id AND uf.user_id = ?
      ${availabilityJoin}
      ${availabilityWhere}
    `).all(userId) as Row[];

    const historyByTrackId = new Map<string, string[]>();
    const historyRows = this.db.prepare(`
      SELECT track_id, played_at
      FROM history
      WHERE user_id = ?
      ORDER BY played_at DESC, id DESC
    `).all(userId) as Row[];

    for (const row of historyRows) {
      const trackId = stringValue(row.track_id);
      const playedAt = stringValue(row.played_at);
      if (!trackId || !playedAt) continue;
      const current = historyByTrackId.get(trackId);
      if (current) current.push(playedAt);
      else historyByTrackId.set(trackId, [playedAt]);
    }

    const tracks: SmartPlaylistTrackSnapshot[] = [];
    for (const row of rows) {
      const id = stringValue(row.id);
      if (eligibleTrackIds && !eligibleTrackIds.has(id)) continue;
      const metadata = canonicalMetadata.get(id);
      const title = metadata?.title ?? stringValue(row.title);
      const artist = metadata?.artist ?? stringValue(row.artist);
      const album = metadata?.album ?? stringValue(row.album);
      const folderPath = stringValue(row.folder_path);
      tracks.push({
        id,
        title,
        artist,
        album,
        folderPath,
        normalizedArtist: normalizeComparable(artist),
        normalizedAlbum: normalizeComparable(album),
        normalizedFolderPath: normalizeFolderPath(folderPath),
        playedAt: historyByTrackId.get(id) ?? [],
        favoriteCreatedAt: typeof row.favorite_created_at === 'string'
          ? row.favorite_created_at
          : null
      });
    }
    return tracks;
  }

  private evaluateSnapshot(
    rule: SmartPlaylistRule,
    tracks: readonly SmartPlaylistTrackSnapshot[],
    now = new Date()
  ) {
    const normalizedRule = normalizeSmartPlaylistRule(rule);
    if (!normalizedRule) throw new RangeError('Regra da playlist inteligente inválida.');
    const since = normalizedRule.periodDays == null
      ? null
      : new Date(now.getTime() - normalizedRule.periodDays * 24 * 60 * 60 * 1_000).toISOString();
    const artistFilter = normalizedRule.artist == null
      ? null
      : normalizeComparable(normalizedRule.artist);
    const albumFilter = normalizedRule.album == null
      ? null
      : normalizeComparable(normalizedRule.album);
    const folderFilter = normalizedRule.folderPath == null
      ? null
      : normalizeFolderPath(normalizedRule.folderPath);

    const evaluated: EvaluatedTrack[] = [];
    for (const track of tracks) {
      if (artistFilter != null && track.normalizedArtist !== artistFilter) continue;
      if (albumFilter != null && track.normalizedAlbum !== albumFilter) continue;
      if (
        folderFilter != null
        && track.normalizedFolderPath !== folderFilter
        && !track.normalizedFolderPath.startsWith(`${folderFilter}/`)
      ) {
        continue;
      }
      if (
        normalizedRule.favorite != null
        && normalizedRule.favorite !== Boolean(track.favoriteCreatedAt)
      ) {
        continue;
      }

      const history = scopedHistory(track.playedAt, since);
      if (normalizedRule.history === 'never' && track.playedAt.length > 0) continue;
      if (normalizedRule.history === 'played' && history.plays === 0) continue;

      evaluated.push({
        id: track.id,
        title: track.title,
        artist: track.artist,
        plays: history.plays,
        lastPlayedAt: history.lastPlayedAt,
        favoriteCreatedAt: track.favoriteCreatedAt
      });
    }

    return evaluated
      .sort((left, right) => sortTracks(normalizedRule, left, right))
      .slice(0, normalizedRule.limit)
      .map(track => track.id);
  }

  evaluate(
    userId: string,
    rule: SmartPlaylistRule,
    eligibleTrackIds?: ReadonlySet<string>,
    now = new Date()
  ) {
    const canonicalMetadata = this.normalization.canonicalMetadataByTrackId();
    const snapshot = this.loadEvaluationSnapshot(userId, canonicalMetadata, eligibleTrackIds);
    return this.evaluateSnapshot(rule, snapshot, now);
  }

  list(userId: string, eligibleTrackIds?: ReadonlySet<string>, now = new Date()): Playlist[] {
    requireUserId(userId);
    const rows = this.db.prepare(`
      SELECT id, name, source_key, created_at, updated_at
      FROM playlists
      WHERE source = ? AND owner_user_id = ?
      ORDER BY updated_at DESC, name COLLATE NOCASE, id ASC
    `).all(SMART_PLAYLIST_SOURCE, userId) as Row[];

    const definitions = rows.flatMap(row => {
      const id = stringValue(row.id);
      const rule = parseStoredRule(row.source_key, id);
      return rule ? [{ row, id, rule }] : [];
    });
    if (definitions.length === 0) return [];

    const canonicalMetadata = this.normalization.canonicalMetadataByTrackId();
    const snapshot = this.loadEvaluationSnapshot(userId, canonicalMetadata, eligibleTrackIds);

    return definitions.map(({ row, id, rule }) => ({
      id,
      name: stringValue(row.name),
      trackIds: this.evaluateSnapshot(rule, snapshot, now),
      createdAt: stringValue(row.created_at),
      updatedAt: stringValue(row.updated_at),
      source: 'smart',
      rule
    }));
  }

  get(userId: string, id: string, eligibleTrackIds?: ReadonlySet<string>, now = new Date()) {
    requireUserId(userId);
    requirePlaylistId(id);
    const row = this.db.prepare(`
      SELECT id, name, source_key, created_at, updated_at
      FROM playlists
      WHERE id = ? AND source = ? AND owner_user_id = ?
    `).get(id, SMART_PLAYLIST_SOURCE, userId) as Row | undefined;
    if (!row) return null;
    const rule = parseStoredRule(row.source_key, id);
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
      INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanName,
      now,
      now,
      SMART_PLAYLIST_SOURCE,
      encodeStoredRule(id, normalizedRule),
      userId
    );
    return id;
  }

  update(userId: string, id: string, patch: { name?: string; rule?: SmartPlaylistRule }) {
    requireUserId(userId);
    requirePlaylistId(id);
    const current = this.db.prepare(`
      SELECT name, source_key
      FROM playlists
      WHERE id = ? AND source = ? AND owner_user_id = ?
    `).get(id, SMART_PLAYLIST_SOURCE, userId) as Row | undefined;
    if (!current) return false;

    const currentRule = parseStoredRule(current.source_key, id);
    if (!currentRule) return false;
    const name = patch.name == null ? stringValue(current.name) : patch.name.trim();
    if (!name || name.length > 120) throw new RangeError('Nome da playlist inteligente inválido.');
    const rule = patch.rule == null ? currentRule : normalizeSmartPlaylistRule(patch.rule);
    if (!rule) throw new RangeError('Regra da playlist inteligente inválida.');
    const result = this.db.prepare(`
      UPDATE playlists
      SET name = ?, source_key = ?, updated_at = ?
      WHERE id = ? AND source = ? AND owner_user_id = ?
    `).run(
      name,
      encodeStoredRule(id, rule),
      new Date().toISOString(),
      id,
      SMART_PLAYLIST_SOURCE,
      userId
    );
    return Number(result.changes) === 1;
  }

  delete(userId: string, id: string) {
    requireUserId(userId);
    requirePlaylistId(id);
    const result = this.db.prepare(`
      DELETE FROM playlists
      WHERE id = ? AND source = ? AND owner_user_id = ?
    `).run(id, SMART_PLAYLIST_SOURCE, userId);
    return Number(result.changes) === 1;
  }
}
