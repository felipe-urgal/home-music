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
  | 'self-management-not-allowed'
  | 'last-admin'
  | 'actor-no-longer-admin';

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

  private withWriteTransaction<T>(operation: () => AdminUserResult<T>): AdminUserResult<T> {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = operation();
      this.db.exec(result.ok ? 'COMMIT;' : 'ROLLBACK;');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserva o erro original se a transação já tiver sido encerrada pelo SQLite.
      }
      throw error;
    }
  }

  private actorIsActiveAdmin(userId: string) {
    if (!userId || userId.length > MAX_USER_ID_LENGTH) return false;
    return Boolean(this.db.prepare(`
      SELECT 1
      FROM users
      WHERE id = ? AND role = 'admin' AND enabled = 1
      LIMIT 1;
    `).get(userId));
  }

  private activeAdminCount() {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM users
      WHERE role = 'admin' AND enabled = 1;
    `).get() as Row | undefined;
    const total = Number(row?.total);
    return Number.isSafeInteger(total) && total >= 0 ? total : 0;
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

  async createUser(
    actorUserId: string,
    usernameInput: string,
    roleInput: unknown
  ): Promise<AdminUserResult<AdminUserCreateResponse>> {
    const normalized = normalizeUsername(usernameInput);
    if (!normalized) return { ok: false, error: 'invalid-username' };

    const role = roleInput == null ? 'user' : roleValue(roleInput);
    if (!role) return { ok: false, error: 'invalid-role' };
    if (!this.actorIsActiveAdmin(actorUserId)) {
      return { ok: false, error: 'actor-no-longer-admin' };
    }

    const duplicate = this.db.prepare('SELECT id FROM users WHERE username_normalized = ? LIMIT 1;')
      .get(normalized.usernameNormalized);
    if (duplicate) return { ok: false, error: 'duplicate-username' };

    const generatedPassword = temporaryPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const id = randomUUID();
    const now = new Date().toISOString();

    try {
      return this.withWriteTransaction(() => {
        if (!this.actorIsActiveAdmin(actorUserId)) {
          return { ok: false, error: 'actor-no-longer-admin' };
        }

        const duplicateInsideTransaction = this.db
          .prepare('SELECT id FROM users WHERE username_normalized = ? LIMIT 1;')
          .get(normalized.usernameNormalized);
        if (duplicateInsideTransaction) return { ok: false, error: 'duplicate-username' };

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

        const user = this.getUser(id);
        if (!user) throw new Error('Usuário criado não pôde ser relido do SQLite.');
        return {
          ok: true,
          value: { user, temporaryPassword: generatedPassword }
        };
      });
    } catch (error) {
      if (isDuplicateUsernameError(error)) return { ok: false, error: 'duplicate-username' };
      throw error;
    }
  }

  setRole(actorUserId: string, targetUserId: string, roleInput: unknown): AdminUserResult<AdminUser> {
    const role = roleValue(roleInput);
    if (!role) return { ok: false, error: 'invalid-role' };

    const result = this.withWriteTransaction(() => {
      if (!this.actorIsActiveAdmin(actorUserId)) {
        return { ok: false, error: 'actor-no-longer-admin' };
      }
      if (actorUserId === targetUserId) {
        return { ok: false, error: 'self-management-not-allowed' };
      }

      const target = this.getUser(targetUserId);
      if (!target) return { ok: false, error: 'not-found' };
      if (target.enabled && target.role === 'admin' && role !== 'admin' && this.activeAdminCount() <= 1) {
        return { ok: false, error: 'last-admin' };
      }

      const now = new Date().toISOString();
      this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?;')
        .run(role, now, targetUserId);

      const user = this.getUser(targetUserId);
      if (!user) throw new Error('Usuário alterado não pôde ser relido do SQLite.');
      return { ok: true, value: user };
    });

    if (result.ok) this.sessions.revokeUserSessions(targetUserId);
    return result;
  }

  setEnabled(actorUserId: string, targetUserId: string, enabledInput: unknown): AdminUserResult<AdminUser> {
    if (typeof enabledInput !== 'boolean') return { ok: false, error: 'invalid-enabled' };

    const result = this.withWriteTransaction(() => {
      if (!this.actorIsActiveAdmin(actorUserId)) {
        return { ok: false, error: 'actor-no-longer-admin' };
      }
      if (actorUserId === targetUserId) {
        return { ok: false, error: 'self-management-not-allowed' };
      }

      const target = this.getUser(targetUserId);
      if (!target) return { ok: false, error: 'not-found' };
      if (target.enabled && target.role === 'admin' && !enabledInput && this.activeAdminCount() <= 1) {
        return { ok: false, error: 'last-admin' };
      }

      const now = new Date().toISOString();
      this.db.prepare('UPDATE users SET enabled = ?, updated_at = ? WHERE id = ?;')
        .run(enabledInput ? 1 : 0, now, targetUserId);

      const user = this.getUser(targetUserId);
      if (!user) throw new Error('Usuário alterado não pôde ser relido do SQLite.');
      return { ok: true, value: user };
    });

    if (result.ok) this.sessions.revokeUserSessions(targetUserId);
    return result;
  }

  async resetPassword(actorUserId: string, targetUserId: string): Promise<AdminUserResult<AdminUserPasswordResetResponse>> {
    if (!this.actorIsActiveAdmin(actorUserId)) {
      return { ok: false, error: 'actor-no-longer-admin' };
    }
    if (actorUserId === targetUserId) return { ok: false, error: 'self-management-not-allowed' };
    if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };

    const generatedPassword = temporaryPassword();
    const passwordHash = await hashPassword(generatedPassword);
    const now = new Date().toISOString();

    const result = this.withWriteTransaction(() => {
      if (!this.actorIsActiveAdmin(actorUserId)) {
        return { ok: false, error: 'actor-no-longer-admin' };
      }
      if (actorUserId === targetUserId) {
        return { ok: false, error: 'self-management-not-allowed' };
      }
      if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };

      this.db.prepare(`
        UPDATE users
        SET password_hash = ?, password_must_change = 1,
            password_changed_at = ?, updated_at = ?
        WHERE id = ?;
      `).run(passwordHash, now, now, targetUserId);

      const user = this.getUser(targetUserId);
      if (!user) throw new Error('Usuário alterado não pôde ser relido do SQLite.');
      return {
        ok: true,
        value: { user, temporaryPassword: generatedPassword }
      };
    });

    if (result.ok) this.sessions.revokeUserSessions(targetUserId);
    return result;
  }

  revokeSessions(actorUserId: string, targetUserId: string): AdminUserResult<AdminUserSessionsRevokeResponse> {
    if (!this.actorIsActiveAdmin(actorUserId)) {
      return { ok: false, error: 'actor-no-longer-admin' };
    }
    if (actorUserId === targetUserId) return { ok: false, error: 'self-management-not-allowed' };
    if (!this.getUser(targetUserId)) return { ok: false, error: 'not-found' };
    return {
      ok: true,
      value: { revokedSessions: this.sessions.revokeUserSessions(targetUserId) }
    };
  }
}
