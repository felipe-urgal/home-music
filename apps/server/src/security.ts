import path from 'node:path';
import { lstat, realpath, stat } from 'node:fs/promises';

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
