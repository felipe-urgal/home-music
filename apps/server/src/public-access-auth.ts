import { DatabaseSync } from 'node:sqlite';
import { PASSWORD_MAX_BYTES, verifyPassword } from './password.js';
import { normalizeUsername } from './user-identity.js';

type Row = Record<string, unknown>;

export async function verifyPublicAccessAdmin(
  databasePath: string,
  username: string,
  password: string,
  minimumCharacters = 20
) {
  if (
    Array.from(password).length < minimumCharacters
    || !password.trim()
    || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
  ) {
    return false;
  }

  const identity = normalizeUsername(username);
  if (!identity) return false;

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 5000;');
  try {
    let row: Row | undefined;
    try {
      row = db.prepare(`
        SELECT id, password_hash
        FROM users
        WHERE username_normalized = ?
          AND role = 'admin'
          AND enabled = 1
          AND password_must_change = 0
        LIMIT 1;
      `).get(identity.usernameNormalized) as Row | undefined;
    } catch {
      return false;
    }

    if (typeof row?.id !== 'string' || typeof row.password_hash !== 'string') return false;
    if (!await verifyPassword(password, row.password_hash)) return false;

    const current = db.prepare(`
      SELECT 1
      FROM users
      WHERE id = ?
        AND username_normalized = ?
        AND role = 'admin'
        AND enabled = 1
        AND password_must_change = 0
        AND password_hash = ?
      LIMIT 1;
    `).get(row.id, identity.usernameNormalized, row.password_hash);
    return Boolean(current);
  } finally {
    db.close();
  }
}
