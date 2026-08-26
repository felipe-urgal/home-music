import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { HomeMusicDatabase } from './database.js';
import { hashPassword, PASSWORD_MAX_BYTES } from './password.js';
import { normalizeUsername } from './user-identity.js';

export type BootstrapInitialAdminResult =
  | { status: 'created'; userId: string }
  | { status: 'already-initialized' }
  | { status: 'credentials-not-bootstrapable'; reason: 'username' | 'password' };

export type BootstrapInitialAdminOptions = {
  databasePath: string;
  username: string;
  password: string;
  now?: () => Date;
  createId?: () => string;
};

function passwordCanBootstrap(password: string) {
  return password.length >= 12 && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES;
}

function ensureCurrentSchema(databasePath: string) {
  const database = new HomeMusicDatabase(databasePath);
  database.close();
}

function claimPendingLegacyFavorites(db: DatabaseSync, userId: string) {
  db.prepare(`
    INSERT OR IGNORE INTO favorites(user_id, track_id, created_at)
    SELECT ?, track_id, created_at
    FROM legacy_favorites_pending;
  `).run(userId);
  db.exec('DELETE FROM legacy_favorites_pending;');
}

function claimPendingLegacyHistory(db: DatabaseSync, userId: string) {
  db.prepare(`
    INSERT INTO history(user_id, track_id, played_at)
    SELECT ?, track_id, played_at
    FROM legacy_history_pending
    ORDER BY id ASC;
  `).run(userId);
  db.exec('DELETE FROM legacy_history_pending;');
}

function claimPendingLegacyManualPlaylists(db: DatabaseSync, userId: string) {
  db.prepare(`
    INSERT INTO playlists(
      id, name, created_at, updated_at, source, source_key, owner_user_id
    )
    SELECT id, name, created_at, updated_at, 'manual', NULL, ?
    FROM legacy_manual_playlists_pending
    ORDER BY created_at ASC, id ASC;
  `).run(userId);

  db.exec(`
    INSERT INTO playlist_tracks(playlist_id, track_id, position)
    SELECT playlist_id, track_id, position
    FROM legacy_manual_playlist_tracks_pending
    ORDER BY playlist_id ASC, position ASC;

    DELETE FROM legacy_manual_playlist_tracks_pending;
    DELETE FROM legacy_manual_playlists_pending;
  `);
}

function claimPendingLegacyPlaybackState(db: DatabaseSync, userId: string) {
  db.prepare(`
    INSERT INTO playback_state(
      user_id, current_track_id, position, volume, shuffle, repeat_mode,
      was_playing, base_queue_json, queue_json, updated_at
    )
    SELECT ?, current_track_id, position, volume, shuffle, repeat_mode,
           was_playing, base_queue_json, queue_json, updated_at
    FROM legacy_playback_state_pending
    WHERE id = 1
    ON CONFLICT(user_id) DO NOTHING;
  `).run(userId);
  db.exec('DELETE FROM legacy_playback_state_pending;');
}

function claimPendingLegacyPersonalData(db: DatabaseSync, userId: string) {
  claimPendingLegacyFavorites(db, userId);
  claimPendingLegacyHistory(db, userId);
  claimPendingLegacyManualPlaylists(db, userId);
  claimPendingLegacyPlaybackState(db, userId);
}

function claimPendingPersonalDataForExistingUser(db: DatabaseSync) {
  const pendingFavorites = db.prepare('SELECT 1 FROM legacy_favorites_pending LIMIT 1;').get();
  const pendingHistory = db.prepare('SELECT 1 FROM legacy_history_pending LIMIT 1;').get();
  const pendingManualPlaylists = db.prepare('SELECT 1 FROM legacy_manual_playlists_pending LIMIT 1;').get();
  const pendingPlaybackState = db.prepare('SELECT 1 FROM legacy_playback_state_pending LIMIT 1;').get();
  if (!pendingFavorites && !pendingHistory && !pendingManualPlaylists && !pendingPlaybackState) return;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const firstUser = db.prepare(`
      SELECT id
      FROM users
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
    `).get() as { id?: unknown } | undefined;
    if (typeof firstUser?.id !== 'string' || !firstUser.id) {
      db.exec('ROLLBACK;');
      return;
    }

    claimPendingLegacyPersonalData(db, firstUser.id);
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserva o erro original.
    }
    throw error;
  }
}

export async function bootstrapInitialAdmin(
  options: BootstrapInitialAdminOptions
): Promise<BootstrapInitialAdminResult> {
  ensureCurrentSchema(options.databasePath);

  const db = new DatabaseSync(options.databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  try {
    const existing = db.prepare('SELECT 1 FROM users LIMIT 1;').get();
    if (existing) {
      claimPendingPersonalDataForExistingUser(db);
      return { status: 'already-initialized' };
    }

    const identity = normalizeUsername(options.username);
    if (!identity) {
      return { status: 'credentials-not-bootstrapable', reason: 'username' };
    }
    if (!passwordCanBootstrap(options.password)) {
      return { status: 'credentials-not-bootstrapable', reason: 'password' };
    }

    const passwordHash = await hashPassword(options.password);
    const userId = (options.createId ?? randomUUID)();
    const timestamp = (options.now ?? (() => new Date()))().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      const initializedWhileHashing = db.prepare('SELECT 1 FROM users LIMIT 1;').get() as { id?: unknown } | undefined;
      if (initializedWhileHashing) {
        db.exec('ROLLBACK;');
        claimPendingPersonalDataForExistingUser(db);
        return { status: 'already-initialized' };
      }

      db.prepare(`
        INSERT INTO users (
          id,
          username,
          username_normalized,
          password_hash,
          role,
          enabled,
          password_must_change,
          created_at,
          updated_at,
          password_changed_at
        ) VALUES (?, ?, ?, ?, 'admin', 1, 0, ?, ?, ?);
      `).run(
        userId,
        identity.username,
        identity.usernameNormalized,
        passwordHash,
        timestamp,
        timestamp,
        timestamp
      );

      claimPendingLegacyPersonalData(db, userId);

      db.exec('COMMIT;');
      return { status: 'created', userId };
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Preserva o erro original.
      }
      throw error;
    }
  } finally {
    db.close();
  }
}
