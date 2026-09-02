import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { parseFile, parseStream, type IAudioMetadata } from 'music-metadata';
import type { AdminLibraryIntegrityStatus, Track } from '@home-music/shared';
import { mapWithConcurrency } from './bounded-concurrency.js';
import {
  abortLibraryIntegrityCheck,
  beginLibraryIntegrityCheck,
  clearLibraryIntegrityFileFailures,
  finishLibraryIntegrityCheck,
  getLibraryIntegrityStatus,
  hasLibraryIntegrityFileFailure,
  probeMediaFile,
  recordLibraryIntegrityIssue
} from './library-integrity.js';
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
const DEFAULT_SCAN_CONCURRENCY = 4;
const MAX_SCAN_CONCURRENCY = 8;
const INTEGRITY_MEDIA_CHECK_CONCURRENCY = 4;

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

export type LibraryTrackDelta = {
  added: IndexedTrack[];
  updated: IndexedTrack[];
  removedIds: string[];
};

export type LibraryScanResult = {
  tracks: IndexedTrack[];
  stats: LibraryScanStats;
  delta: LibraryTrackDelta;
};

type ScannableFile = {
  path: string;
  size: number;
  mtimeMs: number;
};

type ScanMetadataTask = {
  file: ScannableFile;
  previous?: IndexedTrack;
  detectedTrackId: string;
  reusePrevious: boolean;
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

function compareTracks(a: IndexedTrack, b: IndexedTrack) {
  return a.artist.localeCompare(b.artist, 'pt-BR') || a.title.localeCompare(b.title, 'pt-BR');
}

function scannerErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'O scanner não conseguiu ler os metadados do arquivo.';
}

function scanConcurrency(raw = process.env.HOME_MUSIC_SCAN_CONCURRENCY) {
  const configured = Number(raw);
  if (!Number.isInteger(configured) || configured < 1) return DEFAULT_SCAN_CONCURRENCY;
  return Math.min(configured, MAX_SCAN_CONCURRENCY);
}

async function collectScannablePaths(
  dir: string,
  libraryRoot: string,
  unavailableDirectories: string[],
  onWarning?: ScanWarningHandler
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (dir === libraryRoot) throw error;
    unavailableDirectories.push(dir);
    onWarning?.(`Subpasta ignorada durante o scan: ${relativeFilePath(libraryRoot, dir)}`, error);
    return [];
  }

  const candidates: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      candidates.push(...await collectScannablePaths(fullPath, libraryRoot, unavailableDirectories, onWarning));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    candidates.push(fullPath);
  }

  return candidates;
}

async function walk(
  dir: string,
  libraryRoot: string,
  unavailableDirectories: string[],
  onWarning?: ScanWarningHandler
): Promise<ScannableFile[]> {
  const candidates = await collectScannablePaths(dir, libraryRoot, unavailableDirectories, onWarning);
  const resolved = await mapWithConcurrency(
    candidates,
    scanConcurrency(),
    async fullPath => {
      try {
        const safeFile = await resolveRegularFileInside(libraryRoot, fullPath);
        return {
          path: safeFile.path,
          size: safeFile.stat.size,
          mtimeMs: safeFile.stat.mtimeMs
        } satisfies ScannableFile;
      } catch (error) {
        onWarning?.(`Arquivo ignorado durante o scan: ${relativeFilePath(libraryRoot, fullPath)}`, error);
        return null;
      }
    }
  );

  return resolved.filter((file): file is ScannableFile => file !== null);
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
  metadata: IAudioMetadata | null,
  existingTrackId?: string
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
    id: existingTrackId || trackId(libraryRoot, file.path),
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

async function recordScannerAndProbeFailure(
  libraryRoot: string,
  file: ScannableFile,
  scannerError: unknown,
  detectedTrackId?: string
) {
  recordLibraryIntegrityIssue({
    kind: 'scanner-failed',
    filePath: file.path,
    trackId: detectedTrackId ?? null,
    message: `Scanner não conseguiu ler os metadados: ${scannerErrorMessage(scannerError)}`
  });
  const probe = await probeMediaFile(file.path);
  if (probe.status === 'failed') {
    recordLibraryIntegrityIssue({
      kind: 'media-probe-failed',
      filePath: file.path,
      trackId: detectedTrackId ?? null,
      message: probe.message || 'ffprobe rejeitou o arquivo.'
    });
  }
}

async function verifyMediaIntegrity(
  libraryRoot: string,
  file: ScannableFile,
  detectedTrackId: string,
  onWarning?: ScanWarningHandler
) {
  try {
    await parseFile(file.path, { duration: true });
  } catch (error) {
    onWarning?.(`Metadados inválidos durante verificação: ${relativeFilePath(libraryRoot, file.path)}`, error);
    recordLibraryIntegrityIssue({
      kind: 'scanner-failed',
      filePath: file.path,
      trackId: detectedTrackId,
      message: `Scanner não conseguiu ler os metadados: ${scannerErrorMessage(error)}`
    });
  }

  const probe = await probeMediaFile(file.path);
  if (probe.status === 'failed') {
    recordLibraryIntegrityIssue({
      kind: 'media-probe-failed',
      filePath: file.path,
      trackId: detectedTrackId,
      message: probe.message || 'ffprobe rejeitou o arquivo.'
    });
  }
}

async function metadataForFile(
  libraryRoot: string,
  file: ScannableFile,
  onWarning?: ScanWarningHandler,
  detectedTrackId?: string
) {
  let metadata: IAudioMetadata | null = null;
  try {
    metadata = await parseFile(file.path, { duration: true });
  } catch (error) {
    onWarning?.(`Metadados inválidos; usando fallback: ${relativeFilePath(libraryRoot, file.path)}`, error);
    await recordScannerAndProbeFailure(libraryRoot, file, error, detectedTrackId);
  }
  return metadata;
}

export async function indexLibraryFile(
  libraryRoot: string,
  filePath: string,
  existingTrackId?: string,
  onWarning?: ScanWarningHandler
): Promise<IndexedTrack> {
  return withMediaQuarantineLock(async () => {
    const extension = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error('Arquivo promovido possui extensão não suportada pela biblioteca.');
    }

    const safeFile = await resolveRegularFileInside(libraryRoot, filePath);
    const file: ScannableFile = {
      path: safeFile.path,
      size: safeFile.stat.size,
      mtimeMs: safeFile.stat.mtimeMs
    };
    const detectedTrackId = existingTrackId || trackId(libraryRoot, file.path);
    const metadata = await metadataForFile(libraryRoot, file, onWarning, detectedTrackId);
    return fromMetadata(libraryRoot, file, metadata, existingTrackId);
  });
}

export function mergeIndexedTrack(tracks: IndexedTrack[], indexed: IndexedTrack) {
  const next = tracks.filter(track => track.id !== indexed.id && track.filePath !== indexed.filePath);
  next.push(indexed);
  next.sort(compareTracks);
  return next;
}

export async function auditLibraryIntegrity(
  libraryRoot: string,
  indexedTracks: readonly IndexedTrack[],
  onWarning?: ScanWarningHandler
): Promise<AdminLibraryIntegrityStatus> {
  return withMediaQuarantineLock(async () => {
    const firstVerification = getLibraryIntegrityStatus().checkedAt == null;
    beginLibraryIntegrityCheck(libraryRoot);
    try {
      const unavailableDirectories: string[] = [];
      const files = await walk(libraryRoot, libraryRoot, unavailableDirectories, onWarning);
      const indexedByPath = new Map(indexedTracks.map(track => [track.filePath, track]));
      const seenPaths = new Set<string>();
      const mediaChecks: Array<{ file: ScannableFile; trackId: string }> = [];

      for (const file of files) {
        seenPaths.add(file.path);
        const indexed = indexedByPath.get(file.path);
        const changed = Boolean(indexed && (
          indexed.fileSize !== file.size || indexed.mtimeMs !== file.mtimeMs
        ));
        const needsMediaCheck = firstVerification || !indexed || changed || hasLibraryIntegrityFileFailure(file.path);

        clearLibraryIntegrityFileFailures(file.path);
        const detectedTrackId = indexed?.id || trackId(libraryRoot, file.path);
        if (!indexed) {
          recordLibraryIntegrityIssue({
            kind: 'unindexed-file',
            filePath: file.path,
            trackId: detectedTrackId,
            message: 'Arquivo encontrado sem registro correspondente no índice atual.'
          });
        }
        if (needsMediaCheck) mediaChecks.push({ file, trackId: detectedTrackId });
      }

      await mapWithConcurrency(
        mediaChecks,
        INTEGRITY_MEDIA_CHECK_CONCURRENCY,
        async ({ file, trackId: detectedTrackId }) => {
          await verifyMediaIntegrity(libraryRoot, file, detectedTrackId, onWarning);
        }
      );

      for (const indexed of indexedTracks) {
        if (seenPaths.has(indexed.filePath)) continue;
        if (await isQuarantinedTrackFilePresent(libraryRoot, indexed.id, indexed.filePath)) continue;
        if (unavailableDirectories.some(directory => isPathInside(directory, indexed.filePath))) continue;

        recordLibraryIntegrityIssue({
          kind: 'missing-file',
          filePath: indexed.filePath,
          trackId: indexed.id,
          message: 'Registro indexado não possui arquivo correspondente no caminho esperado.'
        });
      }

      return finishLibraryIntegrityCheck();
    } catch (error) {
      abortLibraryIntegrityCheck();
      throw error;
    }
  });
}

export async function scanLibrary(
  libraryRoot: string,
  previousTracks: IndexedTrack[] = [],
  onWarning?: ScanWarningHandler
): Promise<LibraryScanResult> {
  return withMediaQuarantineLock(async () => {
    beginLibraryIntegrityCheck(libraryRoot);
    try {
      const unavailableDirectories: string[] = [];
      const files = await walk(libraryRoot, libraryRoot, unavailableDirectories, onWarning);
      const previousByPath = new Map(previousTracks.map(track => [track.filePath, track]));
      const seenPaths = new Set<string>();
      const tracks: IndexedTrack[] = [];
      const metadataTasks: ScanMetadataTask[] = [];
      const stats: LibraryScanStats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
      const delta: LibraryTrackDelta = { added: [], updated: [], removedIds: [] };

      for (const file of files) {
        seenPaths.add(file.path);
        const previous = previousByPath.get(file.path);
        const fileUnchanged = Boolean(previous && previous.fileSize === file.size && previous.mtimeMs === file.mtimeMs);
        const shouldRecheckFailure = fileUnchanged && hasLibraryIntegrityFileFailure(file.path);

        if (fileUnchanged) {
          stats.unchanged += 1;
          if (!shouldRecheckFailure) {
            tracks.push(previous!);
            continue;
          }

          clearLibraryIntegrityFileFailures(file.path);
          metadataTasks.push({
            file,
            previous,
            detectedTrackId: previous!.id,
            reusePrevious: true
          });
          continue;
        }

        clearLibraryIntegrityFileFailures(file.path);
        const detectedTrackId = previous?.id || trackId(libraryRoot, file.path);
        if (!previous) {
          recordLibraryIntegrityIssue({
            kind: 'unindexed-file',
            filePath: file.path,
            trackId: detectedTrackId,
            message: 'Arquivo encontrado sem registro anterior no índice; o scan atual o incluiu para revisão.'
          });
          stats.added += 1;
        } else {
          stats.updated += 1;
        }

        metadataTasks.push({
          file,
          previous,
          detectedTrackId,
          reusePrevious: false
        });
      }

      const scannedTracks = await mapWithConcurrency(
        metadataTasks,
        scanConcurrency(),
        async task => {
          const metadata = await metadataForFile(libraryRoot, task.file, onWarning, task.detectedTrackId);
          return task.reusePrevious
            ? task.previous!
            : fromMetadata(libraryRoot, task.file, metadata, task.previous?.id);
        }
      );
      tracks.push(...scannedTracks);
      scannedTracks.forEach((track, index) => {
        const task = metadataTasks[index];
        if (task.reusePrevious) return;
        if (task.previous) delta.updated.push(track);
        else delta.added.push(track);
      });

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

        recordLibraryIntegrityIssue({
          kind: 'missing-file',
          filePath: previous.filePath,
          trackId: previous.id,
          message: 'Registro indexado não possui mais arquivo correspondente no caminho esperado.'
        });
        stats.removed += 1;
        delta.removedIds.push(previous.id);
      }

      tracks.sort(compareTracks);
      finishLibraryIntegrityCheck();
      return { tracks, stats, delta };
    } catch (error) {
      abortLibraryIntegrityCheck();
      throw error;
    }
  });
}
