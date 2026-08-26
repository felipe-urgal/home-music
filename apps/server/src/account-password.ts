import { DatabaseSync } from 'node:sqlite';
import type { SessionManager } from './auth.js';
import { hashPassword, PASSWORD_MAX_BYTES, verifyPassword } from './password.js';
import { normalizeUsername } from './user-identity.js';

const MAX_USER_ID_LENGTH = 128;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 12;

type Row = Record<string, unknown>;
type SessionRevoker = Pick<SessionManager, 'revokeUserSessions'>;

export type RequiredPasswordChangeError =
  | 'invalid-current-password'
  | 'weak-new-password'
  | 'same-password'
  | 'not-required'
  | 'stale-account';

export type RequiredPasswordChangeResult =
  | { ok: true }
  | { ok: false; error: RequiredPasswordChangeError };

function validUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_USER_ID_LENGTH;
}

function storedPasswordHash(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function accountPasswordIsStrong(password: string) {
  return (
    Array.from(password).length >= ACCOUNT_PASSWORD_MIN_LENGTH
    && password.trim().length > 0
    && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES
  );
}

export class AccountPasswordService {
  private readonly db: DatabaseSync;

  constructor(databasePath: string, private readonly sessions: SessionRevoker) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  private fallbackPasswordHash() {
    const row = this.db.prepare(`
      SELECT password_hash
      FROM users
      WHERE password_hash <> ''
      ORDER BY id ASC
      LIMIT 1;
    `).get() as Row | undefined;
    return storedPasswordHash(row?.password_hash);
  }

  async authenticateBoundUser(userId: string, username: string, password: string) {
    if (!validUserId(userId)) return false;
    const identity = normalizeUsername(username);
    const row = this.db.prepare(`
      SELECT username_normalized, password_hash, enabled, password_must_change
      FROM users
      WHERE id = ?
      LIMIT 1;
    `).get(userId) as Row | undefined;
    const passwordHash = storedPasswordHash(row?.password_hash);
    if (!passwordHash || !await verifyPassword(password, passwordHash)) return false;

    if (
      !identity
      || row?.enabled !== 1
      || row?.password_must_change !== 0
      || row?.username_normalized !== identity.usernameNormalized
    ) {
      return false;
    }

    const current = this.db.prepare(`
      SELECT 1
      FROM users
      WHERE id = ?
        AND username_normalized = ?
        AND enabled = 1
        AND password_must_change = 0
        AND password_hash = ?
      LIMIT 1;
    `).get(userId, identity.usernameNormalized, passwordHash);
    return Boolean(current);
  }

  async authenticateRequiredPasswordChange(username: string, password: string) {
    const identity = normalizeUsername(username);
    const row = identity
      ? this.db.prepare(`
          SELECT id, password_hash, enabled, password_must_change
          FROM users
          WHERE username_normalized = ?
          LIMIT 1;
        `).get(identity.usernameNormalized) as Row | undefined
      : undefined;

    const realHash = storedPasswordHash(row?.password_hash);
    const passwordHash = realHash ?? this.fallbackPasswordHash();
    if (!passwordHash) return null;

    const matches = await verifyPassword(password, passwordHash);
    if (
      !matches
      || !realHash
      || row?.enabled !== 1
      || row?.password_must_change !== 1
      || !validUserId(row.id)
    ) {
      return null;
    }

    const current = this.db.prepare(`
      SELECT 1
      FROM users
      WHERE id = ?
        AND enabled = 1
        AND password_must_change = 1
        AND password_hash = ?
      LIMIT 1;
    `).get(row.id, realHash);

    return current ? row.id : null;
  }

  async changeRequiredPassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<RequiredPasswordChangeResult> {
    if (!validUserId(userId)) return { ok: false, error: 'not-required' };

    const row = this.db.prepare(`
      SELECT password_hash, enabled, password_must_change
      FROM users
      WHERE id = ?
      LIMIT 1;
    `).get(userId) as Row | undefined;

    const currentHash = storedPasswordHash(row?.password_hash);
    if (!currentHash || row?.enabled !== 1 || row?.password_must_change !== 1) {
      return { ok: false, error: 'not-required' };
    }

    if (!await verifyPassword(currentPassword, currentHash)) {
      return { ok: false, error: 'invalid-current-password' };
    }
    if (!accountPasswordIsStrong(newPassword)) {
      return { ok: false, error: 'weak-new-password' };
    }
    if (newPassword === currentPassword) {
      return { ok: false, error: 'same-password' };
    }

    const newHash = await hashPassword(newPassword);
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = this.db.prepare(`
        UPDATE users
        SET password_hash = ?, password_must_change = 0,
            password_changed_at = ?, updated_at = ?
        WHERE id = ?
          AND enabled = 1
          AND password_must_change = 1
          AND password_hash = ?;
      `).run(newHash, now, now, userId, currentHash);

      if (Number(result.changes) !== 1) {
        this.db.exec('ROLLBACK;');
        return { ok: false, error: 'stale-account' };
      }

      this.db.exec('COMMIT;');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserva o erro original se a transação já tiver sido encerrada.
      }
      throw error;
    }

    this.sessions.revokeUserSessions(userId);
    return { ok: true };
  }
}
