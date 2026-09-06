import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import type { SmartPlaylistRule } from '@home-music/shared';
import type {
  PersonalDataImportApplyDomainSummaryV1,
  PersonalDataImportApplySummaryV1
} from '@home-music/shared/personal-data';
import type {
  PersonalDataImportPlan,
  PersonalDataImportPlannedReference
} from './personal-data-import-plan.js';

const HISTORY_CAPACITY = 2_000;
const SMART_PLAYLIST_SOURCE = 'smart';
const SMART_RULE_VERSION = 1;
const LIBRARY_VIEW_MAX_NAME_LENGTH = 120;

type Row = Record<string, unknown>;
type DomainSummary = PersonalDataImportApplyDomainSummaryV1;

type ResolvedPlan = {
  favorites: string[];
  manualPlaylistTrackIds: Map<number, string[]>;
  playbackHistoryTrackIds: Map<number, string>;
  currentTrackId: string | null;
  baseQueueIds: string[];
  queueIds: string[];
};

export class PersonalDataImportApplyStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.ensureLibraryViewsSchema();
  }

  close() {
    this.db.close();
  }

  apply(userId: string, plan: PersonalDataImportPlan): PersonalDataImportApplySummaryV1 {
    requireUserId(userId);
    const user = this.db.prepare('SELECT 1 AS ok FROM users WHERE id = ? LIMIT 1').get(userId);
    if (!user) throw new RangeError('Usuário de destino do import pessoal não existe.');

    const resolved = resolvePlan(plan);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const domains = {
        favorites: this.applyFavorites(userId, resolved.favorites),
        manualPlaylists: this.applyManualPlaylists(userId, plan, resolved),
        smartPlaylists: this.applySmartPlaylists(userId, plan),
        libraryViews: this.applyLibraryViews(userId, plan),
        playbackHistory: this.applyPlaybackHistory(userId, plan, resolved),
        playbackState: this.applyPlaybackState(userId, plan, resolved)
      };
      this.db.exec('COMMIT;');
      return summarize(plan, domains);
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserva o erro original se o SQLite já tiver encerrado a transação.
      }
      throw error;
    }
  }

  private applyFavorites(userId: string, trackIds: string[]): DomainSummary {
    const uniqueTrackIds = unique(trackIds);
    const insert = this.db.prepare(`
      INSERT INTO favorites(user_id, track_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, track_id) DO NOTHING
    `);
    const now = new Date().toISOString();
    let applied = 0;
    for (const trackId of uniqueTrackIds) {
      applied += Number(insert.run(userId, trackId, now).changes);
    }
    return { applied, ignored: uniqueTrackIds.length - applied };
  }

  private applyManualPlaylists(
    userId: string,
    plan: PersonalDataImportPlan,
    resolved: ResolvedPlan
  ): DomainSummary {
    const existing = this.manualPlaylists(userId);
    const insertPlaylist = this.db.prepare(`
      INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
      VALUES (?, ?, ?, ?, 'manual', NULL, ?)
    `);
    const insertTrack = this.db.prepare(`
      INSERT INTO playlist_tracks(playlist_id, track_id, position)
      VALUES (?, ?, ?)
    `);
    let applied = 0;
    let ignored = 0;

    plan.bundle.manualPlaylists.forEach((playlist, playlistIndex) => {
      const trackIds = unique(resolved.manualPlaylistTrackIds.get(playlistIndex) ?? []);
      const duplicate = existing.some(item => {
        return item.name === playlist.name && arraysEqual(item.trackIds, trackIds);
      });
      if (duplicate) {
        ignored += 1;
        return;
      }

      const id = randomUUID();
      insertPlaylist.run(id, playlist.name, playlist.createdAt, playlist.updatedAt, userId);
      trackIds.forEach((trackId, position) => {
        insertTrack.run(id, trackId, position);
      });
      existing.push({ id, name: playlist.name, trackIds });
      applied += 1;
    });

    return { applied, ignored };
  }

  private manualPlaylists(userId: string) {
    const rows = this.db.prepare(`
      SELECT id, name
      FROM playlists
      WHERE source = 'manual' AND owner_user_id = ?
      ORDER BY id ASC
    `).all(userId) as Row[];
    const tracks = this.db.prepare(`
      SELECT track_id
      FROM playlist_tracks
      WHERE playlist_id = ?
      ORDER BY position ASC
    `);
    return rows.map(row => {
      const id = stringValue(row.id);
      return {
        id,
        name: stringValue(row.name),
        trackIds: (tracks.all(id) as Row[]).map(item => stringValue(item.track_id))
      };
    });
  }

  private applySmartPlaylists(userId: string, plan: PersonalDataImportPlan): DomainSummary {
    const rows = this.db.prepare(`
      SELECT id, name, source_key
      FROM playlists
      WHERE source = ? AND owner_user_id = ?
    `).all(SMART_PLAYLIST_SOURCE, userId) as Row[];
    const existing = rows.flatMap(row => {
      const rule = parseSmartRule(row.source_key, stringValue(row.id));
      return rule ? [{ name: stringValue(row.name), rule }] : [];
    });
    const insert = this.db.prepare(`
      INSERT INTO playlists(id, name, created_at, updated_at, source, source_key, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    let applied = 0;
    let ignored = 0;

    for (const playlist of plan.bundle.smartPlaylists) {
      if (existing.some(item => item.name === playlist.name && isDeepStrictEqual(item.rule, playlist.rule))) {
        ignored += 1;
        continue;
      }
      const id = randomUUID();
      insert.run(
        id,
        playlist.name,
        playlist.createdAt,
        playlist.updatedAt,
        SMART_PLAYLIST_SOURCE,
        encodeSmartRule(id, playlist.rule),
        userId
      );
      existing.push({ name: playlist.name, rule: playlist.rule });
      applied += 1;
    }
    return { applied, ignored };
  }

  private applyLibraryViews(userId: string, plan: PersonalDataImportPlan): DomainSummary {
    const rows = this.db.prepare(`
      SELECT name, definition_json
      FROM library_views
      WHERE owner_user_id = ?
    `).all(userId) as Row[];
    const existing = rows.flatMap(row => {
      try {
        return [{ name: stringValue(row.name), definition: JSON.parse(stringValue(row.definition_json)) }];
      } catch {
        return [];
      }
    });
    const insert = this.db.prepare(`
      INSERT INTO library_views(
        id, owner_user_id, name, definition_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    let applied = 0;
    let ignored = 0;

    for (const view of plan.bundle.libraryViews) {
      if (existing.some(item => item.name === view.name && isDeepStrictEqual(item.definition, view.definition))) {
        ignored += 1;
        continue;
      }
      insert.run(
        randomUUID(),
        userId,
        view.name,
        JSON.stringify(view.definition),
        view.createdAt,
        view.updatedAt
      );
      existing.push({ name: view.name, definition: view.definition });
      applied += 1;
    }
    return { applied, ignored };
  }

  private applyPlaybackHistory(
    userId: string,
    plan: PersonalDataImportPlan,
    resolved: ResolvedPlan
  ): DomainSummary {
    const insert = this.db.prepare(`
      INSERT INTO history(user_id, track_id, played_at)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1
        FROM history
        WHERE user_id = ? AND track_id = ? AND played_at = ?
      )
    `);
    let applied = 0;
    let eligible = 0;

    plan.bundle.playbackHistory.forEach((item, index) => {
      const trackId = resolved.playbackHistoryTrackIds.get(index);
      if (!trackId) return;
      eligible += 1;
      applied += Number(insert.run(
        userId,
        trackId,
        item.playedAt,
        userId,
        trackId,
        item.playedAt
      ).changes);
    });

    this.db.prepare(`
      DELETE FROM history
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id
          FROM history
          WHERE user_id = ?
          ORDER BY played_at DESC, id DESC
          LIMIT ?
        )
    `).run(userId, userId, HISTORY_CAPACITY);

    return { applied, ignored: eligible - applied };
  }

  private applyPlaybackState(
    userId: string,
    plan: PersonalDataImportPlan,
    resolved: ResolvedPlan
  ): DomainSummary {
    const currentTrackId = resolved.currentTrackId;
    const baseQueueIds = unique(resolved.baseQueueIds);
    const queueIds = unique(resolved.queueIds);
    if (currentTrackId) {
      if (!baseQueueIds.includes(currentTrackId)) baseQueueIds.unshift(currentTrackId);
      if (!queueIds.includes(currentTrackId)) queueIds.unshift(currentTrackId);
    }

    const imported = plan.bundle.playbackState;
    const next = {
      currentTrackId,
      position: imported.position,
      volume: imported.volume,
      shuffle: imported.shuffle,
      repeatMode: imported.repeatMode,
      wasPlaying: imported.wasPlaying,
      baseQueueIds,
      queueIds,
      updatedAt: imported.updatedAt
    };
    const current = this.db.prepare(`
      SELECT current_track_id, position, volume, shuffle, repeat_mode, was_playing,
             base_queue_json, queue_json, updated_at
      FROM playback_state
      WHERE user_id = ?
    `).get(userId) as Row | undefined;

    if (current && playbackStateEquals(current, next)) {
      return { applied: 0, ignored: 1 };
    }

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
      next.currentTrackId,
      next.position,
      next.volume,
      next.shuffle ? 1 : 0,
      next.repeatMode,
      next.wasPlaying ? 1 : 0,
      JSON.stringify(next.baseQueueIds),
      JSON.stringify(next.queueIds),
      next.updatedAt
    );
    return { applied: 1, ignored: 0 };
  }

  private ensureLibraryViewsSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_views (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND ${LIBRARY_VIEW_MAX_NAME_LENGTH}),
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_library_views_owner_updated
      ON library_views(owner_user_id, updated_at DESC, name COLLATE NOCASE, id);
    `);
  }
}

function resolvePlan(plan: PersonalDataImportPlan): ResolvedPlan {
  const favorites: string[] = [];
  const manualPlaylistTrackIds = new Map<number, string[]>();
  const playbackHistoryTrackIds = new Map<number, string>();
  let currentTrackId: string | null = null;
  const baseQueueIds: string[] = [];
  const queueIds: string[] = [];

  for (const item of plan.references) {
    const trackId = foundTrackId(item);
    if (!trackId) continue;
    switch (item.location.kind) {
      case 'favorite':
        favorites.push(trackId);
        break;
      case 'manual-playlist-track': {
        const tracks = manualPlaylistTrackIds.get(item.location.playlistIndex) ?? [];
        tracks.push(trackId);
        manualPlaylistTrackIds.set(item.location.playlistIndex, tracks);
        break;
      }
      case 'playback-history':
        playbackHistoryTrackIds.set(item.location.index, trackId);
        break;
      case 'playback-current':
        currentTrackId = trackId;
        break;
      case 'playback-base-queue':
        baseQueueIds.push(trackId);
        break;
      case 'playback-queue':
        queueIds.push(trackId);
        break;
    }
  }

  return {
    favorites,
    manualPlaylistTrackIds,
    playbackHistoryTrackIds,
    currentTrackId,
    baseQueueIds,
    queueIds
  };
}

function foundTrackId(item: PersonalDataImportPlannedReference) {
  return item.match.status === 'found' ? item.match.trackId : null;
}

function summarize(
  plan: PersonalDataImportPlan,
  domains: PersonalDataImportApplySummaryV1['domains']
): PersonalDataImportApplySummaryV1 {
  const applied = Object.values(domains).reduce((total, item) => total + item.applied, 0);
  const ignored = Object.values(domains).reduce((total, item) => total + item.ignored, 0);
  return {
    applied,
    ignored,
    missing: plan.preview.references.missing,
    ambiguous: plan.preview.references.ambiguous,
    conflict: plan.preview.references.conflict,
    failed: 0,
    domains
  };
}

function parseSmartRule(value: unknown, expectedId: string): SmartPlaylistRule | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; id?: unknown; rule?: unknown };
    if (parsed.version !== SMART_RULE_VERSION || parsed.id !== expectedId) return null;
    if (!parsed.rule || typeof parsed.rule !== 'object' || Array.isArray(parsed.rule)) return null;
    return parsed.rule as SmartPlaylistRule;
  } catch {
    return null;
  }
}

function encodeSmartRule(id: string, rule: SmartPlaylistRule) {
  return JSON.stringify({ version: SMART_RULE_VERSION, id, rule });
}

function playbackStateEquals(
  row: Row,
  next: {
    currentTrackId: string | null;
    position: number;
    volume: number;
    shuffle: boolean;
    repeatMode: string;
    wasPlaying: boolean;
    baseQueueIds: string[];
    queueIds: string[];
    updatedAt: string;
  }
) {
  return nullableString(row.current_track_id) === next.currentTrackId
    && Number(row.position) === next.position
    && Number(row.volume) === next.volume
    && Boolean(row.shuffle) === next.shuffle
    && stringValue(row.repeat_mode) === next.repeatMode
    && Boolean(row.was_playing) === next.wasPlaying
    && arraysEqual(jsonStringArray(row.base_queue_json), next.baseQueueIds)
    && arraysEqual(jsonStringArray(row.queue_json), next.queueIds)
    && stringValue(row.updated_at) === next.updatedAt;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function jsonStringArray(value: unknown) {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function requireUserId(userId: string) {
  if (!userId || userId.length > 128) throw new RangeError('userId pessoal inválido.');
}
