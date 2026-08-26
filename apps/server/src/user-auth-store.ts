import { DatabaseSync } from 'node:sqlite';
import type { AuthenticatedUser, UserRole } from '@home-music/shared';

const MAX_SESSION_USER_ID_LENGTH = 128;

type Row = Record<string, unknown>;

export type AuthenticatedUserState = AuthenticatedUser & {
  passwordMustChange: boolean;
};

function userRole(value: unknown): UserRole | null {
  return value === 'admin' || value === 'user' ? value : null;
}

function validIdentityField(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function booleanFlag(value: unknown) {
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

export class UserAuthStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  getEnabledUserById(userId: string): AuthenticatedUserState | null {
    if (!validIdentityField(userId, MAX_SESSION_USER_ID_LENGTH)) return null;

    const row = this.db.prepare(`
      SELECT id, username, role, password_must_change
      FROM users
      WHERE id = ?
        AND enabled = 1
      LIMIT 1;
    `).get(userId) as Row | undefined;

    if (!row) return null;

    const role = userRole(row.role);
    const passwordMustChange = booleanFlag(row.password_must_change);
    if (
      !validIdentityField(row.id, MAX_SESSION_USER_ID_LENGTH)
      || !validIdentityField(row.username, 120)
      || !role
      || passwordMustChange == null
    ) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      role,
      passwordMustChange
    };
  }
}
