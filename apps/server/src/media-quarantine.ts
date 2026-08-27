import { mkdirSync } from 'node:fs';
import { lstat, mkdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AdminQuarantinedTrack, Track } from '@home-music/shared';
import {
  isPathInside,
  resolveLibraryRoot,
  resolveRegularFileInside,
  UnsafeLibraryPathError
} from './security.js';

const QUARANTINE_DIR = '.home-music-trash';
const QUARANTINE_FILES_DIR = 'files';
const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Row = Record<string, unknown>;
type QuarantineState = 'quarantined' | 'deleted';

type QuarantineRecord = {
  trackId: string;
  libraryRoot: string;
  originalRelativePath: string;
  quarantineRelativePath: string;
  track: Track;
  previousEnabled: boolean;
  state: QuarantineState;
  quarantinedAt: string;
  updatedAt: string;
  lastError: string | null;
};

let mediaOperationTail: Promise<void> = Promise.resolve();

export function withMediaQuarantineLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = mediaOperationTail.then(operation, operation);
  mediaOperationTail = run.then(() => undefined, () => undefined);
  return run;
}

export class MediaQuarantineOperationError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 500,
    message: string
  ) {
    super(message);
    this.name = 'MediaQuarantineOperationError';
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function stateValue(value: unknown): QuarantineState {
  return value === 'deleted' ? 'deleted' : 'quarantined';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMissingError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function requireTrackId(trackId: string) {
  if (!TRACK_ID_RE.test(trackId)) {
    throw new MediaQuarantineOperationError(400, 'Identificador de música inválido.');
  }
}

function validateRelativePath(value: string, label: string) {
  if (!value || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new UnsafeLibraryPathError(`${label} inválido.`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new UnsafeLibraryPathError(`${label} inválido.`);
  }
  return parts;
}

function originalRelativePath(root: string, absolutePath: string) {
  if (!isPathInside(root, absolutePath)) throw new UnsafeLibraryPathError();
  const relative = path.relative(root, absolutePath).split(path.sep).join('/');
  const parts = validateRelativePath(relative, 'Caminho original');
  if (parts[0] === QUARANTINE_DIR) {
    throw new UnsafeLibraryPathError('A origem já está na lixeira.');
  }
  return relative;
}

function quarantineRelativePath(trackId: string, originalPath: string) {
  requireTrackId(trackId);
  const extension = path.extname(originalPath).toLowerCase();
  return `${QUARANTINE_DIR}/${QUARANTINE_FILES_DIR}/${trackId}${extension}`;
}

async function ensureSafeDirectory(root: string, relativeParts: string[]) {
  let current = root;
  for (const part of relativeParts) {
    if (!part || part === '.' || part === '..' || part.includes(path.sep)) {
      throw new UnsafeLibraryPathError('Diretório de destino inválido.');
    }
    const candidate = path.join(current, part);
    try {
      const entry = await lstat(candidate);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new UnsafeLibraryPathError('Diretório de destino inseguro.');
      }
    } catch (error) {
      if (!isMissingError(error)) throw error;
      await mkdir(candidate, { mode: 0o700 });
    }
    const resolved = await realpath(candidate);
    if (!isPathInside(root, resolved)) throw new UnsafeLibraryPathError();
    current = resolved;
  }
  return current;
}

async function assertPathAbsent(candidate: string) {
  try {
    await lstat(candidate);
  } catch (error) {
    if (isMissingError(error)) return;
    throw error;
  }
  throw new MediaQuarantineOperationError(409, 'Já existe um arquivo no destino da operação.');
}

function trackFromJson(value: unknown): Track {
  try {
    const parsed = JSON.parse(stringValue(value)) as Track;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') throw new Error();
    return parsed;
  } catch {
    throw new MediaQuarantineOperationError(500, 'Registro da lixeira está corrompido.');
  }
}

function recordFromRow(row: Row): QuarantineRecord {
  return {
    trackId: stringValue(row.track_id),
    libraryRoot: stringValue(row.library_root),
    originalRelativePath: stringValue(row.original_relative_path),
    quarantineRelativePath: stringValue(row.quarantine_relative_path),
    track: trackFromJson(row.track_json),
    previousEnabled: Boolean(row.previous_enabled),
    state: stateValue(row.state),
    quarantinedAt: stringValue(row.quarantined_at),
    updatedAt: stringValue(row.updated_at),
    lastError: row.last_error == null ? null : stringValue(row.last_error)
  };
}

export async function isQuarantinedTrackFilePresent(
  libraryRoot: string,
  trackId: string,
  originalPath: string
) {
  try {
    const relative = quarantineRelativePath(trackId, originalPath);
    const candidate = path.join(libraryRoot, ...relative.split('/'));
    await resolveRegularFileInside(libraryRoot, candidate);
    return true;
  } catch {
    return false;
  }
}

export class MediaQuarantineStore {
  private readonly db: DatabaseSync;
  private readonly hiddenTrackIds = new Set<string>();

  constructor(
    databasePath: string,
    private readonly musicDir: string
  ) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_quarantine (
        track_id TEXT PRIMARY KEY,
        library_root TEXT NOT NULL,
        original_relative_path TEXT NOT NULL,
        quarantine_relative_path TEXT NOT NULL UNIQUE,
        track_json TEXT NOT NULL,
        previous_enabled INTEGER NOT NULL CHECK(previous_enabled IN (0, 1)),
        state TEXT NOT NULL CHECK(state IN ('quarantined', 'deleted')),
        quarantined_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
    `);
    this.pruneResolvedTombstones();
    this.reloadHiddenTrackIds();
  }

  close() {
    this.db.close();
  }

  private reloadHiddenTrackIds() {
    const rows = this.db.prepare('SELECT track_id FROM media_quarantine;').all() as Row[];
    this.hiddenTrackIds.clear();
    for (const row of rows) {
      const id = stringValue(row.track_id);
      if (id) this.hiddenTrackIds.add(id);
    }
  }

  private record(trackId: string) {
    const row = this.db.prepare(`
      SELECT track_id, library_root, original_relative_path, quarantine_relative_path,
             track_json, previous_enabled, state, quarantined_at, updated_at, last_error
      FROM media_quarantine
      WHERE track_id = ?;
    `).get(trackId) as Row | undefined;
    return row ? recordFromRow(row) : null;
  }

  private setLastError(trackId: string, error: unknown) {
    this.db.prepare(`
      UPDATE media_quarantine
      SET last_error = ?, updated_at = ?
      WHERE track_id = ?;
    `).run(errorMessage(error).slice(0, 1000), new Date().toISOString(), trackId);
  }

  hasHidden(trackId: string) {
    return this.hiddenTrackIds.has(trackId);
  }

  pruneResolvedTombstones() {
    const deleted = this.db.prepare(`
      SELECT q.track_id
      FROM media_quarantine q
      LEFT JOIN tracks t ON t.id = q.track_id
      WHERE q.state = 'deleted' AND t.id IS NULL;
    `).all() as Row[];
    const remove = this.db.prepare('DELETE FROM media_quarantine WHERE track_id = ?;');
    for (const row of deleted) remove.run(stringValue(row.track_id));
    this.reloadHiddenTrackIds();
  }

  listItems(): AdminQuarantinedTrack[] {
    const rows = this.db.prepare(`
      SELECT track_id, library_root, original_relative_path, quarantine_relative_path,
             track_json, previous_enabled, state, quarantined_at, updated_at, last_error
      FROM media_quarantine
      WHERE state = 'quarantined'
      ORDER BY quarantined_at DESC, track_id ASC;
    `).all() as Row[];

    return rows.map(row => {
      const record = recordFromRow(row);
      return {
        ...record.track,
        quarantinedAt: record.quarantinedAt,
        originalPath: record.originalRelativePath,
        lastError: record.lastError
      };
    });
  }

  async quarantine(trackId: string, track: Track, previousEnabled: boolean) {
    requireTrackId(trackId);
    if (!this.musicDir) throw new MediaQuarantineOperationError(409, 'MUSIC_DIR não está configurado.');

    return withMediaQuarantineLock(async () => {
      if (this.hasHidden(trackId)) {
        throw new MediaQuarantineOperationError(409, 'Música já está na lixeira.');
      }

      const root = await resolveLibraryRoot(this.musicDir);
      const row = this.db.prepare('SELECT file_path FROM tracks WHERE id = ?;').get(trackId) as Row | undefined;
      const filePath = stringValue(row?.file_path);
      if (!filePath) throw new MediaQuarantineOperationError(404, 'Música não encontrada.');

      let source;
      try {
        source = await resolveRegularFileInside(root, filePath);
      } catch (error) {
        if (isMissingError(error)) throw new MediaQuarantineOperationError(404, 'Arquivo da música não foi encontrado.');
        throw error;
      }

      const originalRelative = originalRelativePath(root, source.path);
      const quarantineRelative = quarantineRelativePath(trackId, source.path);
      const quarantineDir = await ensureSafeDirectory(root, [QUARANTINE_DIR, QUARANTINE_FILES_DIR]);
      const quarantinePath = path.join(quarantineDir, path.basename(quarantineRelative));
      await assertPathAbsent(quarantinePath);

      await rename(source.path, quarantinePath);
      const now = new Date().toISOString();
      try {
        this.db.prepare(`
          INSERT INTO media_quarantine(
            track_id, library_root, original_relative_path, quarantine_relative_path,
            track_json, previous_enabled, state, quarantined_at, updated_at, last_error
          ) VALUES (?, ?, ?, ?, ?, ?, 'quarantined', ?, ?, NULL);
        `).run(
          trackId,
          root,
          originalRelative,
          quarantineRelative,
          JSON.stringify(track),
          previousEnabled ? 1 : 0,
          now,
          now
        );
      } catch (error) {
        try {
          await rename(quarantinePath, source.path);
        } catch (rollbackError) {
          try {
            this.db.prepare(`
              INSERT OR REPLACE INTO media_quarantine(
                track_id, library_root, original_relative_path, quarantine_relative_path,
                track_json, previous_enabled, state, quarantined_at, updated_at, last_error
              ) VALUES (?, ?, ?, ?, ?, ?, 'quarantined', ?, ?, ?);
            `).run(
              trackId,
              root,
              originalRelative,
              quarantineRelative,
              JSON.stringify(track),
              previousEnabled ? 1 : 0,
              now,
              new Date().toISOString(),
              `Falha ao registrar e ao reverter movimentação: ${errorMessage(rollbackError)}`.slice(0, 1000)
            );
            this.hiddenTrackIds.add(trackId);
          } catch {
            // A falha original continua sendo reportada; o arquivo permanece confinado à lixeira.
          }
          throw new MediaQuarantineOperationError(
            500,
            'A música foi movida para a lixeira, mas houve falha ao registrar a operação. Verifique os logs.'
          );
        }
        throw error;
      }

      this.hiddenTrackIds.add(trackId);
      return this.listItems().find(item => item.id === trackId)!;
    });
  }

  async restore(
    trackId: string,
    restoreAvailability: (enabled: boolean) => void,
    rollbackAvailability: () => void
  ) {
    requireTrackId(trackId);
    if (!this.musicDir) throw new MediaQuarantineOperationError(409, 'MUSIC_DIR não está configurado.');

    return withMediaQuarantineLock(async () => {
      const record = this.record(trackId);
      if (!record || record.state !== 'quarantined') {
        throw new MediaQuarantineOperationError(404, 'Música não encontrada na lixeira.');
      }

      const root = await resolveLibraryRoot(this.musicDir);
      if (record.libraryRoot !== root) {
        throw new MediaQuarantineOperationError(409, 'A raiz da biblioteca mudou desde que a música foi movida.');
      }

      const originalParts = validateRelativePath(record.originalRelativePath, 'Caminho original');
      if (originalParts[0] === QUARANTINE_DIR) throw new UnsafeLibraryPathError('Caminho original inválido.');
      const quarantineParts = validateRelativePath(record.quarantineRelativePath, 'Caminho da lixeira');
      if (quarantineParts[0] !== QUARANTINE_DIR || quarantineParts[1] !== QUARANTINE_FILES_DIR) {
        throw new UnsafeLibraryPathError('Caminho da lixeira inválido.');
      }

      const quarantinePath = path.join(root, ...quarantineParts);
      let source;
      try {
        source = await resolveRegularFileInside(root, quarantinePath);
      } catch (error) {
        this.setLastError(trackId, error);
        if (isMissingError(error)) {
          throw new MediaQuarantineOperationError(409, 'Arquivo da lixeira não foi encontrado.');
        }
        throw error;
      }

      const parent = await ensureSafeDirectory(root, originalParts.slice(0, -1));
      const destination = path.join(parent, originalParts.at(-1)!);
      try {
        await assertPathAbsent(destination);
      } catch (error) {
        this.setLastError(trackId, error);
        throw error;
      }

      await rename(source.path, destination);
      try {
        restoreAvailability(record.previousEnabled);
        this.db.prepare('DELETE FROM media_quarantine WHERE track_id = ?;').run(trackId);
        this.hiddenTrackIds.delete(trackId);
        return record.track;
      } catch (error) {
        try {
          rollbackAvailability();
        } catch {
          // A disponibilidade permanece defensivamente desativada sempre que possível.
        }
        try {
          await rename(destination, source.path);
        } catch (rollbackError) {
          this.setLastError(trackId, rollbackError);
          throw new MediaQuarantineOperationError(
            500,
            'A restauração falhou e não foi possível devolver o arquivo à lixeira. Verifique os logs.'
          );
        }
        this.setLastError(trackId, error);
        throw error;
      }
    });
  }

  async deletePermanently(trackId: string) {
    requireTrackId(trackId);
    if (!this.musicDir) throw new MediaQuarantineOperationError(409, 'MUSIC_DIR não está configurado.');

    return withMediaQuarantineLock(async () => {
      const record = this.record(trackId);
      if (!record || record.state !== 'quarantined') {
        throw new MediaQuarantineOperationError(404, 'Música não encontrada na lixeira.');
      }

      const root = await resolveLibraryRoot(this.musicDir);
      if (record.libraryRoot !== root) {
        throw new MediaQuarantineOperationError(409, 'A raiz da biblioteca mudou desde que a música foi movida.');
      }
      const quarantineParts = validateRelativePath(record.quarantineRelativePath, 'Caminho da lixeira');
      if (quarantineParts[0] !== QUARANTINE_DIR || quarantineParts[1] !== QUARANTINE_FILES_DIR) {
        throw new UnsafeLibraryPathError('Caminho da lixeira inválido.');
      }
      const quarantinePath = path.join(root, ...quarantineParts);

      try {
        const file = await resolveRegularFileInside(root, quarantinePath);
        await unlink(file.path);
      } catch (error) {
        if (!isMissingError(error)) {
          this.setLastError(trackId, error);
          throw error;
        }
      }

      const now = new Date().toISOString();
      try {
        this.db.prepare(`
          UPDATE media_quarantine
          SET state = 'deleted', updated_at = ?, last_error = NULL
          WHERE track_id = ?;
        `).run(now, trackId);
      } catch (error) {
        try { this.setLastError(trackId, error); } catch { /* mantém o erro original */ }
        throw error;
      }
      this.hiddenTrackIds.add(trackId);
    });
  }
}
