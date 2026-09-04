import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuthenticatedUser, UserRole } from '@home-music/shared';

const MAX_KEY_NAME_LENGTH = 120;
const MAX_API_KEY_LENGTH = 256;
const API_KEY_PREFIX = 'hm_os_';

type Row = Record<string, unknown>;

export type OpenSubsonicApiKey = Readonly<{
  id: string;
  name: string;
  hint: string;
  createdAt: string;
}>;

export type OpenSubsonicAuthenticatedKey = Readonly<{
  keyId: string;
  user: AuthenticatedUser;
}>;

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function roleValue(value: unknown): UserRole | null {
  return value === 'admin' || value === 'user' ? value : null;
}

function keyHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function cleanName(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_KEY_NAME_LENGTH);
}

function publicKeyFromRow(row: Row): OpenSubsonicApiKey {
  return Object.freeze({
    id: stringValue(row.id),
    name: stringValue(row.name),
    hint: stringValue(row.key_hint),
    createdAt: stringValue(row.created_at)
  });
}

export class OpenSubsonicCredentialStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS open_subsonic_api_keys (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND ${MAX_KEY_NAME_LENGTH}),
        key_hash TEXT NOT NULL UNIQUE CHECK(length(key_hash) = 64),
        key_hint TEXT NOT NULL CHECK(length(key_hint) BETWEEN 1 AND 24),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_open_subsonic_api_keys_user_created
      ON open_subsonic_api_keys(user_id, created_at DESC, id DESC);
    `);
  }

  close() {
    this.db.close();
  }

  list(userId: string): OpenSubsonicApiKey[] {
    if (!userId || userId.length > 128) return [];
    const rows = this.db.prepare(`
      SELECT id, name, key_hint, created_at
      FROM open_subsonic_api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC;
    `).all(userId) as Row[];
    return rows.map(publicKeyFromRow);
  }

  create(userId: string, rawName: unknown) {
    if (!userId || userId.length > 128) return null;
    const name = cleanName(rawName);
    if (!name) return null;

    const token = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const hint = `${API_KEY_PREFIX}…${token.slice(-6)}`;

    this.db.prepare(`
      INSERT INTO open_subsonic_api_keys(id, user_id, name, key_hash, key_hint, created_at)
      VALUES (?, ?, ?, ?, ?, ?);
    `).run(id, userId, name, keyHash(token), hint, createdAt);

    return {
      key: Object.freeze({ id, name, hint, createdAt }) satisfies OpenSubsonicApiKey,
      token
    };
  }

  revoke(userId: string, keyId: string) {
    if (!userId || userId.length > 128 || !keyId || keyId.length > 128) return false;
    const result = this.db.prepare(`
      DELETE FROM open_subsonic_api_keys
      WHERE id = ? AND user_id = ?;
    `).run(keyId, userId);
    return result.changes > 0;
  }

  authenticate(rawKey: unknown): OpenSubsonicAuthenticatedKey | null {
    if (typeof rawKey !== 'string' || rawKey.length < 32 || rawKey.length > MAX_API_KEY_LENGTH) {
      return null;
    }

    const row = this.db.prepare(`
      SELECT
        api.id AS key_id,
        users.id AS user_id,
        users.username AS username,
        users.role AS role
      FROM open_subsonic_api_keys AS api
      INNER JOIN users ON users.id = api.user_id
      WHERE api.key_hash = ?
        AND users.enabled = 1
        AND users.password_must_change = 0
      LIMIT 1;
    `).get(keyHash(rawKey)) as Row | undefined;

    if (!row) return null;
    const role = roleValue(row.role);
    const keyId = stringValue(row.key_id);
    const userId = stringValue(row.user_id);
    const username = stringValue(row.username);
    if (!role || !keyId || !userId || !username) return null;

    return Object.freeze({
      keyId,
      user: Object.freeze({ id: userId, username, role })
    });
  }
}
