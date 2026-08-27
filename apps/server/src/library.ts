import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { parseFile, parseStream, type IAudioMetadata } from 'music-metadata';
import type { Track } from '@home-music/shared';
import { isQuarantinedTrackFilePresent, withMediaQuarantineLock } from './media-quarantine.js';
import { replayGainDb } from './replay-gain.js';
import { isPathInside, resolveRegularFileInside } from './security.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'
]);

const ALLOWED_COVER_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const MAX_COVER_BYTES = 8 * 1024 * 1024;

export type IndexedTrack = Track & {
  filePath: string;
  mimeType: string;
  fileSize: number;
  mtimeMs: number;
};

export type LibraryScanStats = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
};

export type LibraryScanResult = {
  tracks: IndexedTrack[];
  stats: LibraryScanStats;
};

type ScannableFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

export type ScanWarningHandler = (message: string, error?: unknown) => void;

const mimeByExtension: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
};

function relativeFilePath(libraryRoot: string, filePath: string) {
  return path.relative(libraryRoot, filePath).split(path.sep).join('/');
}

function trackId(libraryRoot: string, filePath: string) {
  return createHash('sha256').update(relativeFilePath(libraryRoot, filePath)).digest('hex').slice(0, 24);
}

function relativeFolder(libraryRoot: string, filePath: string) {
  const relativePath = relativeFilePath(libraryRoot, filePath);
  const folderPath = path.posix.dirname(relativePath);
  const safeFolderPath = folderPath === '.' ? '' : folderPath;
  const folder = safeFolderPath.split('/').filter(Boolean)[0] || 'Sem pasta';
  return { folder, folderPath: safeFolderPath };
}

async function walk(
  dir: string,
  libraryRoot: string,
  unavailableDirectories: string[],
  onWarning?: ScanWarningHandler
): Promise<ScannableFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (dir === libraryRoot) throw error;
    unavailableDirectories.push(dir);
    onWarning?.(`Subpasta ignorada durante o scan: ${relativeFilePath(libraryRoot, dir)}`, error);
    return [];
  }

  const files: ScannableFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath, libraryRoot, unavailableDirectories, onWarning));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    try {
      const safeFile = await resolveRegularFileInside(libraryRoot, fullPath);
      files.push({
        path: safeFile.path,
        size: safeFile.stat.size,
        mtimeMs: safeFile.stat.mtimeMs
      });
    } catch (error) {
      onWarning?.(`Arquivo ignorado durante o scan: ${relativeFilePath(libraryRoot, fullPath)}`, error);
    }
  }

  return files;
}

export async function readCover(stream: Readable, mimeType: string) {
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
}

function fromMetadata(
  libraryRoot: string,
  file: ScannableFile,
  metadata: IAudioMetadata | null
): IndexedTrack {
  const ext = path.extname(file.path).toLowerCase();
  const fallbackTitle = path.basename(file.path, ext);
  const artist = metadata?.common.artist?.trim() || 'Artista desconhecido';
  const picture = metadata?.common.picture?.[0];
  const hasSafeCover = Boolean(
    picture &&
    ALLOWED_COVER_TYPES.has(picture.format) &&
    picture.data.byteLength <= MAX_COVER_BYTES
  );
  const folder = relativeFolder(libraryRoot, file.path);
  const common = metadata?.common as (Record<string, unknown> | undefined);

  return {
    id: trackId(libraryRoot, file.path),
    title: metadata?.common.title?.trim() || fallbackTitle,
    artist,
    album: metadata?.common.album?.trim() || 'Álbum desconhecido',
    albumArtist: metadata?.common.albumartist?.trim() || artist,
    folder: folder.folder,
    folderPath: folder.folderPath,
    duration: metadata?.format.duration ?? null,
    format: ext.replace('.', '').toUpperCase(),
    hasCover: hasSafeCover,
    replayGainTrackDb: replayGainDb(common?.replaygain_track_gain),
    replayGainAlbumDb: replayGainDb(common?.replaygain_album_gain),
    filePath: file.path,
    mimeType: mimeByExtension[ext] || 'application/octet-stream',
    fileSize: file.size,
    mtimeMs: file.mtimeMs
  };
}

export async function scanLibrary(
  libraryRoot: string,
  previousTracks: IndexedTrack[] = [],
  onWarning?: ScanWarningHandler
): Promise<LibraryScanResult> {
  return withMediaQuarantineLock(async () => {
    const unavailableDirectories: string[] = [];
    const files = await walk(libraryRoot, libraryRoot, unavailableDirectories, onWarning);
    const previousByPath = new Map(previousTracks.map(track => [track.filePath, track]));
    const seenPaths = new Set<string>();
    const tracks: IndexedTrack[] = [];
    const stats: LibraryScanStats = { added: 0, updated: 0, removed: 0, unchanged: 0 };

    for (const file of files) {
      seenPaths.add(file.path);
      const previous = previousByPath.get(file.path);

      if (previous && previous.fileSize === file.size && previous.mtimeMs === file.mtimeMs) {
        tracks.push(previous);
        stats.unchanged += 1;
        continue;
      }

      let metadata: IAudioMetadata | null = null;
      try {
        metadata = await parseFile(file.path, { duration: true });
      } catch (error) {
        onWarning?.(`Metadados inválidos; usando fallback: ${relativeFilePath(libraryRoot, file.path)}`, error);
      }

      tracks.push(fromMetadata(libraryRoot, file, metadata));
      if (previous) stats.updated += 1;
      else stats.added += 1;
    }

    for (const previous of previousTracks) {
      if (seenPaths.has(previous.filePath)) continue;

      if (await isQuarantinedTrackFilePresent(libraryRoot, previous.id, previous.filePath)) {
        tracks.push(previous);
        stats.unchanged += 1;
        continue;
      }

      const unavailable = unavailableDirectories.some(directory => isPathInside(directory, previous.filePath));
      if (unavailable) {
        tracks.push(previous);
        stats.unchanged += 1;
        continue;
      }

      stats.removed += 1;
    }

    tracks.sort((a, b) =>
      a.artist.localeCompare(b.artist, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR')
    );

    return { tracks, stats };
  });
}
