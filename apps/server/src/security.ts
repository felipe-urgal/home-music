import { constants } from 'node:fs';
import path from 'node:path';
import { lstat, open, realpath, stat } from 'node:fs/promises';

export class UnsafeLibraryPathError extends Error {
  constructor(message = 'Caminho fora da biblioteca.') {
    super(message);
    this.name = 'UnsafeLibraryPathError';
  }
}

export function isPathInside(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

export async function resolveLibraryRoot(musicDir: string) {
  const resolved = await realpath(musicDir);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new UnsafeLibraryPathError('MUSIC_DIR não é um diretório.');
  return resolved;
}

export async function resolveRegularFileInside(rootPath: string, candidatePath: string) {
  const entry = await lstat(candidatePath);
  if (!entry.isFile()) throw new UnsafeLibraryPathError('A entrada não é um arquivo regular.');

  const resolved = await realpath(candidatePath);
  if (!isPathInside(rootPath, resolved)) throw new UnsafeLibraryPathError();

  const info = await stat(resolved);
  if (!info.isFile()) throw new UnsafeLibraryPathError('A entrada não é um arquivo regular.');

  return { path: resolved, stat: info };
}

export async function openRegularFileInside(rootPath: string, candidatePath: string) {
  const safeFile = await resolveRegularFileInside(rootPath, candidatePath);
  const handle = await open(safeFile.path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new UnsafeLibraryPathError('A entrada aberta não é um arquivo regular.');

    // No alvo Ubuntu/Linux, /proc/self/fd aponta para o inode realmente aberto.
    // Revalidar o descritor elimina a janela entre realpath() e open().
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    if (!isPathInside(rootPath, openedPath)) throw new UnsafeLibraryPathError();

    return { handle, path: openedPath, stat: info };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export type ByteRange = { start: number; end: number };

export function parseByteRange(header: string | undefined, size: number): ByteRange | null | undefined {
  if (!header) return undefined;
  if (!Number.isSafeInteger(size) || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const rawStart = match[1];
  const rawEnd = match[2];
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1
    };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;

  if (!rawEnd) return { start, end: size - 1 };

  const requestedEnd = Number(rawEnd);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < 0) return null;

  const end = Math.min(requestedEnd, size - 1);
  if (start > end) return null;

  return { start, end };
}
