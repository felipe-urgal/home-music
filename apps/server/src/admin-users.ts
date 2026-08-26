import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminUser,
  AdminUserCreateResponse,
  AdminUserPasswordResetResponse,
  AdminUserSessionsRevokeResponse,
  UserRole
} from '@home-music/shared';
import type { SessionManager } from './auth.js';
import { hashPassword } from './password.js';
import { normalizeUsername } from './user-identity.js';

const MAX_USER_ID_LENGTH = 128;
const TEMPORARY_PASSWORD_BYTES = 18;

type Row = Record<string, unknown>;

type AdminUserError =
  | 'invalid-username'
  | 'invalid-role'
  | 'invalid-enabled'
  | 'duplicate-username'
  | 'not-found'
  | 'self-management-not-allowed';

export type AdminUserResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AdminUserError };

type SessionRevoker = Pick<SessionManager, 'revokeUserSessions'>;

function roleValue(value: unknown): UserRole | null {
  return value === 'admin' || value === 'user' ? value : null;
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Registro de usuário inválido: ${field}.`);
  }
  return value;
}

function booleanValue(value: unknown, field: string) {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`Registro de usuário inválido: ${field}.`);
}

function nullableString(value: unknown, field: string) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`Registro de usuário inválido: ${field}.`);
  return value;
}

function adminUserFromRow(row: Row): AdminUser {
  const role = roleValue(row.role);
  if (!role) throw new Error('Registro de usuário inválido: role.');

  return {
    id: requiredString(row.id, 'id', MAX_USER_ID_LENGTH),
    username: requiredString(row.username, 'username', 120),
    role,
    enabled: booleanValue(row.enabled, 'enabled'),
    passwordMustChange: booleanValue(row.password_must_change, 'password_must_change'),
    createdAt: requiredString(row.created_at, 'created_at', 64),
    updatedAt: requiredString(row.updated_at, 'updated_at', 64),
    passwordChangedAt: nullableString(row.password_changed_at, 'password_changed_at')
  };
}

function isDuplicateUsernameError(error: unknown) {
  return error instanceof Error
    && error.message.includes('UNIQUE constraint failed: users.username_normalized');
}

function temporaryPassword() {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
}

export class AdminUsersService {
  private readonly db: DatabaseSync;

  constructor(databasePath: string, private readonly sessions: SessionRevoker) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  listUsers(): AdminUser[] {
    const rows = this.db.prepare(`
      SELECT id, username, role, enabled, password_must_change,
             created_at, updated_at, password_changed_at
      FROM users
      ORDER BY username_normalized ASC, id ASC;
    `).all() as Row[];
    return rows.map(adminUserFromRow);
  }

  getUser(userId: string): AdminUser | null {
    if (!userId || userId.length > MAX_USER_ID_LENGTH) return null;
    const row = this.db.prepare(`
      SELECT id, username, role, enabled, password_must_change,
             created_at, updated_at, password_changed_at
      FROM users
      WHERE id = ?
      LIMIT 1;
    `).get(userId) as Row | undefined;
    return row ? adminUserFromRow(row) : null;
  }

  async createUser(usernameInput: string, roleInput: unknown): Promise<AdminUserResult<AdminUserCreateResponse>> {
    const normalized = normalizeUsername(usernameInput);
    if (!normalized) return { ok: false, error: 'invalid-username' };

    const role = roleInput == null ? 'user' : roleValue(roleInput);
    if (!role) return { ok: false, error: 'invalid-role' };

    const duplicate = this.db.prepare('SELECT id FROM users WHERE username_normalized = ? LIMIT 1;')
      .get(normalized.usernameNormalized);
    if (duplicate) return { ok: false, error: 'duplicate-username' };

    const generatedPassword = temporaryPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO users (
          id, username, username_normalized, password_hash, role, enabled,
          password_must_change, created_at, updated_at, password_changed_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?);
      `).run(
        id,
        normalized.username,
        normalized.usernameNormalized,
        passwordHash,
        role,
        now,
        now,
        now
      );
    } catch (error) {
      if (isDuplicateUsernameError(error)) return { ok: false, error: 'duplicate-username' };
      throw error;
    }

    const user = this.getUser(id);
    if (!user) throw new Error('Usuário criado não pôde ser relido do SQLite.');
    return {
      ok: true,
      value: { user, temporaryPassword: generatedPassword }
    };
  }

  setRole(actorUserId: string, targetUserId: string, roleInput: unknown): AdminUserResult<AdminUser> {
    const role = roleValue(roleInput);
    if (!role) return { ok: false, error: 'invalid-role' };
    if (actorUserId === targetUserId) return { ok: false, error: 'self-management-not-allowed' };
    if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };

    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?;')
      .run(role, now, targetUserId);
    this.sessions.revokeUserSessions(targetUserId);

    const user = this.getUser(targetUserId);
    if (!user) throw new Error('Usuário alterado não pôde ser relido do SQLite.');
    return { ok: true, value: user };
  }

  setEnabled(actorUserId: string, targetUserId: string, enabledInput: unknown): AdminUserResult<AdminUser> {
    if (typeof enabledInput !== 'boolean') return { ok: false, error: 'invalid-enabled' };
    if (actorUserId === targetUserId) return { ok: false, error: 'self-management-not-allowed' };
    if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };

    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?;')
      .run(enabledInput ? 1 : 0, now, targetUserId);
    this.sessions.revokeUserSessions(targetUserId);

    const user = this.getUser(targetUserId);
    if (!user) throw new Error('Usuário alterado não pôde ser relido do SQLite.');
    return { ok: true, value: user };
  }

  async resetPassword(actorUserId: string, targetUserId: string): Promise<AdminUserResult<AdminUserPasswordResetResponse>> {
    if (actorUserId === targetUserId) return { ok: false, error: 'self-management-not-allowed' };
    if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };

    const generatedPassword = temporaryPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE users
      SET password_hash = ?, password_must_change = 1,
          password_changed_at = ?, updated_at = ?
      WHERE id = ?;
    `).run(passwordHash, now, now, targetUserId);
    this.sessions.revokeUserSessions(targetUserId);

    const user = this.getUser(targetUserId);
    if (!user) throw new Error('Usuário alterado não pôde ser relido do SQLite.');
    return {
      ok: true,
      value: { user, temporaryPassword: generatedPassword }
    };
  }

  revokeSessions(actorUserId: string, targetUserId: string): AdminUserResult<AdminUserSessionsRevokeResponse> {
    if (actorUserId === targetUserId) return { ok: false, error: 'self-management-not-allowed' };
    if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };
    return {
      ok: true,
      value: { revokedSessions: this.sessions.revokeUserSessions(targetUserId) }
    };
  }
}
