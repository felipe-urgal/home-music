import { mkdirSync } from 'node:fs';
import { lstat, mkdir, realpath, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AdminTrackFileLocation, AdminTrackMoveRequest } from '@home-music/shared';
import { withMediaQuarantineLock } from './media-quarantine.js';
import {
  isPathInside,
  resolveLibraryRoot,
  resolveRegularFileInside,
  UnsafeLibraryPathError
} from './security.js';

const MAX_RELATIVE_PATH_BYTES = 2048;
const MAX_PATH_PART_BYTES = 255;
const HIDDEN_TRASH_DIRECTORY = '.home-music-trash';

type Row = Record<string, unknown>;

export type AppliedTrackLocation = {
  absolutePath: string;
  folder: string;
  folderPath: string;
};

export type MediaFileMoveResult<T> = {
  track: T;
  location: AdminTrackFileLocation;
  moved: boolean;
};

export class MediaFileMoveOperationError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409 | 500,
    message: string
  ) {
    super(message);
    this.name = 'MediaFileMoveOperationError';
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function isMissingError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isCrossDeviceError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && String(error.code) === 'EXDEV');
}

function relativePath(root: string, absolutePath: string) {
  if (!isPathInside(root, absolutePath)) throw new UnsafeLibraryPathError();
  const relative = path.relative(root, absolutePath).split(path.sep).join('/');
  if (!relative || relative === '.' || relative.startsWith('../')) {
    throw new UnsafeLibraryPathError('Caminho da música inválido.');
  }
  return relative;
}

function validatePart(part: string, label: string) {
  if (
    !part
    || part === '.'
    || part === '..'
    || part.includes('\0')
    || part.includes('/')
    || part.includes('\\')
    || part.startsWith('.')
  ) {
    throw new MediaFileMoveOperationError(400, `${label} inválido.`);
  }
  if (Buffer.byteLength(part, 'utf8') > MAX_PATH_PART_BYTES) {
    throw new MediaFileMoveOperationError(400, `${label} é longo demais.`);
  }
  return part;
}

export function normalizeAdminTrackFolderPath(value: unknown) {
  if (typeof value !== 'string') {
    throw new MediaFileMoveOperationError(400, 'Pasta de destino inválida.');
  }
  const normalized = value.trim();
  if (!normalized) return [] as string[];
  if (
    normalized.includes('\0')
    || normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || Buffer.byteLength(normalized, 'utf8') > MAX_RELATIVE_PATH_BYTES
  ) {
    throw new MediaFileMoveOperationError(400, 'Pasta de destino inválida.');
  }
  const parts = normalized.split('/').map(part => validatePart(part, 'Pasta de destino'));
  if (parts[0] === HIDDEN_TRASH_DIRECTORY) {
    throw new MediaFileMoveOperationError(400, 'A pasta interna da lixeira não pode ser usada como destino.');
  }
  return parts;
}

export function normalizeAdminTrackFileName(value: unknown, currentFileName: string) {
  if (typeof value !== 'string') {
    throw new MediaFileMoveOperationError(400, 'Nome do arquivo inválido.');
  }
  const fileName = validatePart(value.trim(), 'Nome do arquivo');
  const currentExtension = path.extname(currentFileName).toLocaleLowerCase('en-US');
  const nextExtension = path.extname(fileName).toLocaleLowerCase('en-US');
  if (!currentExtension || nextExtension !== currentExtension) {
    throw new MediaFileMoveOperationError(400, `A extensão ${currentExtension || 'atual'} deve ser preservada.`);
  }
  return fileName;
}

async function ensureSafeDirectory(root: string, parts: string[]) {
  let current = root;
  const created: string[] = [];

  for (const part of parts) {
    const candidate = path.join(current, part);
    try {
      const entry = await lstat(candidate);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new UnsafeLibraryPathError('Diretório de destino inseguro.');
      }
    } catch (error) {
      if (!isMissingError(error)) throw error;
      await mkdir(candidate, { mode: 0o750 });
      created.push(candidate);
    }

    const resolved = await realpath(candidate);
    if (!isPathInside(root, resolved)) throw new UnsafeLibraryPathError();
    current = resolved;
  }

  return { path: current, created };
}

async function assertDestinationAbsent(destination: string) {
  try {
    await lstat(destination);
  } catch (error) {
    if (isMissingError(error)) return;
    throw error;
  }
  throw new MediaFileMoveOperationError(409, 'Já existe um arquivo no destino escolhido.');
}

async function removeCreatedDirectories(created: string[]) {
  for (const directory of [...created].reverse()) {
    try {
      await rmdir(directory);
    } catch {
      // Mantém diretórios que deixaram de estar vazios ou foram alterados externamente.
    }
  }
}

function folderValues(parts: string[]) {
  const folderPath = parts.join('/');
  return {
    folderPath,
    folder: parts[0] || 'Sem pasta'
  };
}

function locationFrom(root: string, trackId: string, absolutePath: string): AdminTrackFileLocation {
  const relative = relativePath(root, absolutePath);
  const folderPath = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
  return {
    trackId,
    relativePath: relative,
    folderPath,
    fileName: path.posix.basename(relative)
  };
}

export class MediaFileMoveStore {
  private readonly db: DatabaseSync;

  constructor(
    databasePath: string,
    private readonly musicDir: string
  ) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  private filePath(trackId: string) {
    const row = this.db.prepare('SELECT file_path FROM tracks WHERE id = ? LIMIT 1;').get(trackId) as Row | undefined;
    return row ? stringValue(row.file_path) : '';
  }

  async getLocation(trackId: string): Promise<AdminTrackFileLocation | null> {
    if (!this.musicDir) throw new MediaFileMoveOperationError(409, 'MUSIC_DIR não está configurado.');
    const storedPath = this.filePath(trackId);
    if (!storedPath) return null;

    const root = await resolveLibraryRoot(this.musicDir);
    try {
      const source = await resolveRegularFileInside(root, storedPath);
      return locationFrom(root, trackId, source.path);
    } catch (error) {
      if (isMissingError(error)) {
        throw new MediaFileMoveOperationError(409, 'O arquivo indexado não foi encontrado. Execute um novo scan.');
      }
      throw error;
    }
  }

  async move<T>(
    trackId: string,
    request: AdminTrackMoveRequest,
    applyLocation: (location: AppliedTrackLocation) => T | null
  ): Promise<MediaFileMoveResult<T>> {
    if (!this.musicDir) throw new MediaFileMoveOperationError(409, 'MUSIC_DIR não está configurado.');

    return withMediaQuarantineLock(async () => {
      const storedPath = this.filePath(trackId);
      if (!storedPath) throw new MediaFileMoveOperationError(404, 'Música não encontrada.');

      const root = await resolveLibraryRoot(this.musicDir);
      let source;
      try {
        source = await resolveRegularFileInside(root, storedPath);
      } catch (error) {
        if (isMissingError(error)) {
          throw new MediaFileMoveOperationError(409, 'O arquivo indexado não foi encontrado. Execute um novo scan.');
        }
        throw error;
      }

      const currentLocation = locationFrom(root, trackId, source.path);
      const folderParts = normalizeAdminTrackFolderPath(request.folderPath);
      const fileName = normalizeAdminTrackFileName(request.fileName, currentLocation.fileName);
      const folder = folderValues(folderParts);
      const destinationDirectory = await ensureSafeDirectory(root, folderParts);
      const destination = path.join(destinationDirectory.path, fileName);

      if (destination === source.path) {
        const track = applyLocation({
          absolutePath: source.path,
          folder: folder.folder,
          folderPath: folder.folderPath
        });
        if (!track) throw new MediaFileMoveOperationError(409, 'A música mudou durante a operação. Atualize a lista e tente novamente.');
        return { track, location: currentLocation, moved: false };
      }

      await assertDestinationAbsent(destination);

      try {
        await rename(source.path, destination);
      } catch (error) {
        await removeCreatedDirectories(destinationDirectory.created);
        if (isCrossDeviceError(error)) {
          throw new MediaFileMoveOperationError(409, 'O destino está em outro filesystem. Esta movimentação foi bloqueada para preservar atomicidade.');
        }
        throw error;
      }

      let movedPath = destination;
      try {
        movedPath = await realpath(destination);
        if (!isPathInside(root, movedPath)) {
          throw new UnsafeLibraryPathError('O destino resolveu para fora de MUSIC_DIR.');
        }
        const moved = await resolveRegularFileInside(root, destination);
        movedPath = moved.path;
      } catch (error) {
        try {
          await rename(movedPath, source.path);
        } finally {
          await removeCreatedDirectories(destinationDirectory.created);
        }
        throw error;
      }

      const update = this.db.prepare(`
        UPDATE tracks
        SET file_path = ?, folder = ?, folder_path = ?
        WHERE id = ? AND file_path = ?;
      `);

      try {
        this.db.exec('BEGIN IMMEDIATE;');
        const result = update.run(movedPath, folder.folder, folder.folderPath, trackId, storedPath);
        if (Number(result.changes) !== 1) {
          throw new MediaFileMoveOperationError(409, 'A música mudou durante a operação. Atualize a lista e tente novamente.');
        }
        this.db.exec('COMMIT;');
      } catch (error) {
        try { this.db.exec('ROLLBACK;'); } catch { /* transação já encerrada */ }
        try {
          await rename(movedPath, source.path);
        } finally {
          await removeCreatedDirectories(destinationDirectory.created);
        }
        throw error;
      }

      try {
        const track = applyLocation({
          absolutePath: movedPath,
          folder: folder.folder,
          folderPath: folder.folderPath
        });
        if (!track) {
          throw new MediaFileMoveOperationError(409, 'A música mudou durante a operação. Atualize a lista e tente novamente.');
        }
        return {
          track,
          location: locationFrom(root, trackId, movedPath),
          moved: true
        };
      } catch (error) {
        let rollbackError: unknown = null;
        try {
          this.db.exec('BEGIN IMMEDIATE;');
          const result = this.db.prepare(`
            UPDATE tracks
            SET file_path = ?, folder = ?, folder_path = ?
            WHERE id = ? AND file_path = ?;
          `).run(
            source.path,
            currentLocation.folderPath.split('/')[0] || 'Sem pasta',
            currentLocation.folderPath,
            trackId,
            movedPath
          );
          if (Number(result.changes) !== 1) throw new Error('Registro SQLite não pôde ser restaurado.');
          this.db.exec('COMMIT;');
          await rename(movedPath, source.path);
          await removeCreatedDirectories(destinationDirectory.created);
        } catch (failedRollback) {
          rollbackError = failedRollback;
          try { this.db.exec('ROLLBACK;'); } catch { /* transação já encerrada */ }
        }

        if (rollbackError) {
          throw new MediaFileMoveOperationError(
            500,
            'A movimentação falhou e o rollback não pôde ser concluído. Verifique os logs e o filesystem.'
          );
        }
        throw error;
      }
    });
  }
}
