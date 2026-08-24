import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { parseFile, parseStream, type IAudioMetadata } from 'music-metadata';
import type { Track } from '@home-music/shared';
import { resolveRegularFileInside } from './security.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'
]);

const ALLOWED_COVER_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_COVER_READS = 4;

let activeCoverReads = 0;
const coverWaiters: Array<() => void> = [];

export type IndexedTrack = Track & {
  filePath: string;
  mimeType: string;
};

const mimeByExtension: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
};

function trackId(filePath: string) {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 24);
}

function folderName(musicDir: string, filePath: string) {
  const relative = path.relative(musicDir, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  return parts.length > 1 ? parts[0] : 'Sem pasta';
}

async function walk(dir: string, libraryRoot: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath, libraryRoot));
      continue;
    }

    // Symlinks, sockets, FIFOs e devices nunca entram no índice.
    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    try {
      const safeFile = await resolveRegularFileInside(libraryRoot, fullPath);
      files.push(safeFile.path);
    } catch {
      // Entradas que saiam da raiz ou mudem de tipo são ignoradas.
    }
  }

  return files;
}

async function withCoverSlot<T>(operation: () => Promise<T>) {
  if (activeCoverReads >= MAX_CONCURRENT_COVER_READS) {
    await new Promise<void>(resolve => coverWaiters.push(resolve));
  }

  activeCoverReads += 1;
  try {
    return await operation();
  } finally {
    activeCoverReads -= 1;
    coverWaiters.shift()?.();
  }
}

export async function readCover(stream: Readable, mimeType: string) {
  return withCoverSlot(async () => {
    try {
      const metadata = await parseStream(stream, { mimeType }, { duration: false });
      const picture = metadata.common.picture?.[0];
      if (!picture) return undefined;
      if (!ALLOWED_COVER_TYPES.has(picture.format)) return undefined;
      if (picture.data.byteLength > MAX_COVER_BYTES) return undefined;

      return {
        data: picture.data,
        format: picture.format
      };
    } catch {
      return undefined;
    }
  });
}

export async function scanLibrary(libraryRoot: string): Promise<IndexedTrack[]> {
  const files = await walk(libraryRoot, libraryRoot);
  const tracks: IndexedTrack[] = [];

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    let metadata: IAudioMetadata | null = null;

    try {
      metadata = await parseFile(filePath, { duration: true });
    } catch {
      // Arquivos reproduzíveis continuam aparecendo mesmo sem metadados válidos.
    }

    const fallbackTitle = path.basename(filePath, ext);
    const artist = metadata?.common.artist?.trim() || 'Artista desconhecido';
    const picture = metadata?.common.picture?.[0];
    const hasSafeCover = Boolean(
      picture &&
      ALLOWED_COVER_TYPES.has(picture.format) &&
      picture.data.byteLength <= MAX_COVER_BYTES
    );

    tracks.push({
      id: trackId(filePath),
      title: metadata?.common.title?.trim() || fallbackTitle,
      artist,
      album: metadata?.common.album?.trim() || 'Álbum desconhecido',
      albumArtist: metadata?.common.albumartist?.trim() || artist,
      folder: folderName(libraryRoot, filePath),
      duration: metadata?.format.duration ?? null,
      format: ext.replace('.', '').toUpperCase(),
      hasCover: hasSafeCover,
      filePath,
      mimeType: mimeByExtension[ext] || 'application/octet-stream'
    });
  }

  return tracks.sort((a, b) =>
    a.artist.localeCompare(b.artist, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR')
  );
}
