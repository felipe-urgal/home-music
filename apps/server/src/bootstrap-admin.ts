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

function claimPendingLegacyPersonalData(db: DatabaseSync, userId: string) {
  claimPendingLegacyFavorites(db, userId);
  claimPendingLegacyHistory(db, userId);
}

function claimPendingPersonalDataForExistingUser(db: DatabaseSync) {
  const pendingFavorites = db.prepare('SELECT 1 FROM legacy_favorites_pending LIMIT 1;').get();
  const pendingHistory = db.prepare('SELECT 1 FROM legacy_history_pending LIMIT 1;').get();
  if (!pendingFavorites && !pendingHistory) return;

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
