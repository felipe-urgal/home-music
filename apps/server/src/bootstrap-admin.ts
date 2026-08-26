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

export async function bootstrapInitialAdmin(
  options: BootstrapInitialAdminOptions
): Promise<BootstrapInitialAdminResult> {
  ensureCurrentSchema(options.databasePath);

  const db = new DatabaseSync(options.databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  try {
    const existing = db.prepare('SELECT 1 FROM users LIMIT 1;').get();
    if (existing) return { status: 'already-initialized' };

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
      const initializedWhileHashing = db.prepare('SELECT 1 FROM users LIMIT 1;').get();
      if (initializedWhileHashing) {
        db.exec('ROLLBACK;');
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
