import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_GLOBAL_SESSIONS,
  MAX_SESSIONS_PER_USER,
  SESSION_TTL_SECONDS,
  SessionCapacityError,
  SessionManager,
  type AuthSession,
  type PublicAuthSession
} from './auth.js';

export const PERSISTENT_SESSION_EXPIRES_AT = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

type PersistedSessionRow = {
  token_hash: string;
  user_id: string;
  created_at: number;
  authenticated_at: number;
  last_seen_at: number;
};

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicSessionIdFromHash(tokenHash: string) {
  return tokenHash.slice(0, 24);
}

export class PersistentSessionManager extends SessionManager {
  private readonly db: DatabaseSync;

  constructor(
    databasePath: string,
    private readonly persistentMaxSessions = MAX_GLOBAL_SESSIONS,
    private readonly persistentMaxSessionsPerUser = Math.min(
      MAX_SESSIONS_PER_USER,
      persistentMaxSessions
    )
  ) {
    super(
      '',
      '',
      SESSION_TTL_SECONDS * 1000,
      persistentMaxSessions,
      { status: 'blocked' },
      persistentMaxSessionsPerUser
    );

    if (!Number.isInteger(this.persistentMaxSessions) || this.persistentMaxSessions < 1) {
      throw new RangeError('Limite global de sessões persistentes inválido.');
    }
    if (
      !Number.isInteger(this.persistentMaxSessionsPerUser)
      || this.persistentMaxSessionsPerUser < 1
    ) {
      throw new RangeError('Limite de sessões persistentes por usuário inválido.');
    }

    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.ensureSchema();
  }

  close() {
    this.db.close();
  }

  override createSession(_now = Date.now()): string {
    throw new Error('Sessões legadas não são suportadas pelo armazenamento persistente.');
  }

  override createSessionForUser(userId: string, now = Date.now()) {
    if (!userId || userId.length > 128) throw new RangeError('userId de sessão inválido.');

    this.evictOldestPersistentSessionsForUser(userId);
    if (this.countSessions() >= this.persistentMaxSessions) throw new SessionCapacityError();

    let token = '';
    let tokenHash = '';
    do {
      token = randomBytes(32).toString('base64url');
      tokenHash = hashSessionToken(token);
    } while (this.sessionExists(tokenHash));

    this.db.prepare(`
      INSERT INTO auth_sessions(
        token_hash, user_id, created_at, authenticated_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, userId, now, now, now);

    return token;
  }

  override getSession(token: string | undefined, now = Date.now()): AuthSession | null {
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const row = this.getSessionRow(tokenHash);
    if (!row) return null;

    this.touchSession(tokenHash, now);
    return Object.freeze({
      userId: row.user_id,
      createdAt: row.created_at,
      authenticatedAt: row.authenticated_at,
      expiresAt: PERSISTENT_SESSION_EXPIRES_AT
    });
  }

  override validateSession(token: string | undefined, now = Date.now()) {
    return this.getSession(token, now) !== null;
  }

  override revokeSession(token: string | undefined) {
    if (!token) return;
    this.deleteSessionHash(hashSessionToken(token));
  }

  override revokeUserSessions(userId: string) {
    if (!userId) return 0;
    const result = this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
    return Number(result.changes);
  }

  override revokeUserSessionsExcept(
    userId: string,
    currentToken: string | undefined,
    now = Date.now()
  ) {
    if (!userId || !currentToken) return null;
    const currentHash = hashSessionToken(currentToken);
    const current = this.getSessionRow(currentHash);
    if (!current || current.user_id !== userId) return null;

    this.touchSession(currentHash, now);
    const result = this.db.prepare(`
      DELETE FROM auth_sessions
      WHERE user_id = ? AND token_hash <> ?
    `).run(userId, currentHash);
    return Number(result.changes);
  }

  override listUserSessions(
    userId: string,
    currentToken: string | undefined,
    now = Date.now()
  ): PublicAuthSession[] | null {
    if (!userId || !currentToken) return null;
    const currentHash = hashSessionToken(currentToken);
    const current = this.getSessionRow(currentHash);
    if (!current || current.user_id !== userId) return null;

    this.touchSession(currentHash, now);
    const rows = this.db.prepare(`
      SELECT token_hash, user_id, created_at, authenticated_at, last_seen_at
      FROM auth_sessions
      WHERE user_id = ?
      ORDER BY last_seen_at DESC, created_at DESC, token_hash ASC
    `).all(userId) as unknown as PersistedSessionRow[];

    return rows
      .map(row => ({
        id: publicSessionIdFromHash(row.token_hash),
        current: row.token_hash === currentHash,
        createdAt: row.created_at,
        lastSeenAt: row.token_hash === currentHash ? now : row.last_seen_at,
        expiresAt: PERSISTENT_SESSION_EXPIRES_AT
      }))
      .sort(
        (left, right) => Number(right.current) - Number(left.current)
          || right.lastSeenAt - left.lastSeenAt
      );
  }

  override revokeUserSession(
    userId: string,
    publicId: string,
    currentToken: string | undefined,
    now = Date.now()
  ) {
    if (!userId || !publicId || !currentToken) return null;
    const currentHash = hashSessionToken(currentToken);
    const current = this.getSessionRow(currentHash);
    if (!current || current.user_id !== userId) return null;
    this.touchSession(currentHash, now);

    const rows = this.db.prepare(`
      SELECT token_hash, user_id, created_at, authenticated_at, last_seen_at
      FROM auth_sessions
      WHERE user_id = ?
    `).all(userId) as unknown as PersistedSessionRow[];
    const target = rows.find(row => publicSessionIdFromHash(row.token_hash) === publicId);
    if (!target || target.token_hash === currentHash) return false;

    this.deleteSessionHash(target.token_hash);
    return true;
  }

  private ensureSchema() {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash) = 64),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          authenticated_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_last_seen
        ON auth_sessions(user_id, last_seen_at DESC, created_at DESC);
      `);
      this.db.exec('COMMIT;');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserve the original schema error.
      }
      throw error;
    }
  }

  private countSessions() {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get() as {
      count?: number | bigint;
    } | undefined;
    return Number(row?.count ?? 0);
  }

  private sessionExists(tokenHash: string) {
    return Boolean(
      this.db.prepare('SELECT 1 AS present FROM auth_sessions WHERE token_hash = ?').get(tokenHash)
    );
  }

  private getSessionRow(tokenHash: string): PersistedSessionRow | null {
    const row = this.db.prepare(`
      SELECT token_hash, user_id, created_at, authenticated_at, last_seen_at
      FROM auth_sessions
      WHERE token_hash = ?
    `).get(tokenHash) as PersistedSessionRow | undefined;
    return row ?? null;
  }

  private touchSession(tokenHash: string, lastSeenAt: number) {
    this.db.prepare(`
      UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?
    `).run(lastSeenAt, tokenHash);
  }

  private deleteSessionHash(tokenHash: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);
  }

  private evictOldestPersistentSessionsForUser(userId: string) {
    const rows = this.db.prepare(`
      SELECT token_hash
      FROM auth_sessions
      WHERE user_id = ?
      ORDER BY created_at ASC, token_hash ASC
    `).all(userId) as unknown as Array<{ token_hash: string }>;

    while (rows.length >= this.persistentMaxSessionsPerUser) {
      const oldest = rows.shift();
      if (!oldest) break;
      this.deleteSessionHash(oldest.token_hash);
    }
  }
}
