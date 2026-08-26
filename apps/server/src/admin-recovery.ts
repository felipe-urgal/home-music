import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './password.js';
import { normalizeUsername } from './user-identity.js';

const TEMPORARY_PASSWORD_BYTES = 18;

type Row = Record<string, unknown>;

export type AdminRecoveryResult =
  | { ok: true; username: string; temporaryPassword: string }
  | { ok: false; error: 'invalid-username' | 'not-found' | 'database-not-initialized' };

function temporaryPassword() {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
}

export async function recoverLocalAdmin(
  databasePath: string,
  usernameInput: string
): Promise<AdminRecoveryResult> {
  const identity = normalizeUsername(usernameInput);
  if (!identity) return { ok: false, error: 'invalid-username' };

  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 5000;');

  try {
    let row: Row | undefined;
    try {
      row = db.prepare(`
        SELECT id, username
        FROM users
        WHERE username_normalized = ?
        LIMIT 1;
      `).get(identity.usernameNormalized) as Row | undefined;
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such table: users')) {
        return { ok: false, error: 'database-not-initialized' };
      }
      throw error;
    }

    if (typeof row?.id !== 'string' || typeof row.username !== 'string') {
      return { ok: false, error: 'not-found' };
    }

    const generatedPassword = temporaryPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = db.prepare(`
        UPDATE users
        SET role = 'admin',
            enabled = 1,
            password_hash = ?,
            password_must_change = 1,
            password_changed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND username_normalized = ?;
      `).run(passwordHash, now, now, row.id, identity.usernameNormalized);

      if (Number(result.changes) !== 1) {
        db.exec('ROLLBACK;');
        return { ok: false, error: 'not-found' };
      }

      db.exec('COMMIT;');
      return {
        ok: true,
        username: row.username,
        temporaryPassword: generatedPassword
      };
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
