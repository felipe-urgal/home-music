import { DatabaseSync } from 'node:sqlite';
import { normalizeUsername } from './user-identity.js';

const INTERNAL_BINDING_STATE = 'HOME_MUSIC_INTERNAL_LEGACY_BINDING_STATE';
const INTERNAL_BINDING_USER_ID = 'HOME_MUSIC_INTERNAL_LEGACY_BINDING_USER_ID';

export type LegacyAuthBinding =
  | { status: 'bound'; userId: string }
  | { status: 'legacy-uninitialized' }
  | { status: 'blocked' };

type Row = Record<string, unknown>;

export function resolveLegacyAuthBinding(databasePath: string, username: string): LegacyAuthBinding {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 5000;');

  try {
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM users;').get() as Row | undefined;
    const count = Number(countRow?.count ?? 0);
    if (!Number.isFinite(count) || count < 1) return { status: 'legacy-uninitialized' };

    const identity = normalizeUsername(username);
    if (!identity) return { status: 'blocked' };

    const row = db.prepare(`
      SELECT id
      FROM users
      WHERE username_normalized = ?
        AND enabled = 1
      LIMIT 1;
    `).get(identity.usernameNormalized) as Row | undefined;

    const userId = typeof row?.id === 'string' ? row.id : '';
    return userId ? { status: 'bound', userId } : { status: 'blocked' };
  } finally {
    db.close();
  }
}

export function writeLegacyAuthBindingToEnvironment(binding: LegacyAuthBinding) {
  delete process.env[INTERNAL_BINDING_USER_ID];
  process.env[INTERNAL_BINDING_STATE] = binding.status;
  if (binding.status === 'bound') {
    process.env[INTERNAL_BINDING_USER_ID] = binding.userId;
  }
}

export function readLegacyAuthBindingFromEnvironment(): LegacyAuthBinding {
  const status = process.env[INTERNAL_BINDING_STATE];
  if (status === 'blocked') return { status: 'blocked' };
  if (status === 'legacy-uninitialized') return { status: 'legacy-uninitialized' };
  if (status === 'bound') {
    const userId = process.env[INTERNAL_BINDING_USER_ID] || '';
    return userId ? { status: 'bound', userId } : { status: 'blocked' };
  }

  // Desenvolvimento e testes que não passam pelo preload continuam no fluxo legado
  // até a etapa em que o login for migrado integralmente para o SQLite.
  return { status: 'legacy-uninitialized' };
}
