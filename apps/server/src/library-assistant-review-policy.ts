import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY,
  type LibraryAssistantArtworkReviewMode,
  type LibraryAssistantReviewMode,
  type LibraryAssistantReviewPolicy
} from '@home-music/shared/library-assistant';

const POLICY_KEYS = ['title', 'artist', 'album', 'albumArtist', 'artwork', 'lyrics'] as const;
const REVIEW_MODES = new Set<LibraryAssistantReviewMode>(['ignore', 'review', 'bulk']);
const ARTWORK_MODES = new Set<LibraryAssistantArtworkReviewMode>(['ignore', 'review']);

type Row = { policy_json?: unknown };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cloneDefaultPolicy(): LibraryAssistantReviewPolicy {
  return { ...DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY };
}

export function parseLibraryAssistantReviewPolicy(value: unknown): LibraryAssistantReviewPolicy {
  const object = objectValue(value);
  if (!object) throw new TypeError('Política de revisão inválida.');

  const keys = Object.keys(object);
  if (keys.length !== POLICY_KEYS.length || keys.some(key => !POLICY_KEYS.includes(key as typeof POLICY_KEYS[number]))) {
    throw new TypeError('Política de revisão possui campos inválidos.');
  }

  const metadataMode = (key: 'title' | 'artist' | 'album' | 'albumArtist' | 'lyrics') => {
    const mode = object[key];
    if (typeof mode !== 'string' || !REVIEW_MODES.has(mode as LibraryAssistantReviewMode)) {
      throw new TypeError(`Modo de revisão inválido para ${key}.`);
    }
    return mode as LibraryAssistantReviewMode;
  };

  const artwork = object.artwork;
  if (typeof artwork !== 'string' || !ARTWORK_MODES.has(artwork as LibraryAssistantArtworkReviewMode)) {
    throw new TypeError('Modo de revisão inválido para artwork.');
  }

  return {
    title: metadataMode('title'),
    artist: metadataMode('artist'),
    album: metadataMode('album'),
    albumArtist: metadataMode('albumArtist'),
    artwork: artwork as LibraryAssistantArtworkReviewMode,
    lyrics: metadataMode('lyrics')
  };
}

export class LibraryAssistantReviewPolicyStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_assistant_review_policy (
        singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
        policy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  get(): LibraryAssistantReviewPolicy {
    const row = this.db.prepare(`
      SELECT policy_json
      FROM library_assistant_review_policy
      WHERE singleton = 1
      LIMIT 1;
    `).get() as Row | undefined;
    if (!row || typeof row.policy_json !== 'string') return cloneDefaultPolicy();
    try {
      return parseLibraryAssistantReviewPolicy(JSON.parse(row.policy_json) as unknown);
    } catch {
      // Configuração derivada inválida não pode impedir o uso do Assistente.
      return cloneDefaultPolicy();
    }
  }

  set(value: unknown, updatedAt = new Date().toISOString()): LibraryAssistantReviewPolicy {
    const policy = parseLibraryAssistantReviewPolicy(value);
    this.db.prepare(`
      INSERT INTO library_assistant_review_policy(singleton, policy_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET
        policy_json = excluded.policy_json,
        updated_at = excluded.updated_at;
    `).run(JSON.stringify(policy), updatedAt);
    return policy;
  }
}
