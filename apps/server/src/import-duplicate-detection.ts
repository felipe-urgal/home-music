import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminLibraryDuplicateReason,
  ImportJob,
  ImportMetadataValues
} from '@home-music/shared';
import {
  classifyDuplicateSignals,
  duplicateConfidenceRank,
  duplicateDurationMatches,
  duplicateTextMatches
} from './duplicate-comparison.js';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportStagingManager, ImportValidationTarget, ValidatedImportPayload } from './import-staging.js';
import { openRegularFileInside, resolveLibraryRoot } from './security.js';

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const HASH_BUFFER_BYTES = 64 * 1024;
const MAX_HASH_CACHE_ITEMS = 2_048;

export type ImportDuplicateConfidence = 'none' | 'possible' | 'probable' | 'exact';
export type ImportDuplicateDisposition = 'clear' | 'notice' | 'review' | 'blocked';
export type ImportDuplicateReason = AdminLibraryDuplicateReason;

export type ImportDuplicateMatch = Readonly<{
  trackId: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number | null;
  format: string;
  confidence: Exclude<ImportDuplicateConfidence, 'none'>;
  reasons: readonly ImportDuplicateReason[];
}>;

export type ImportDuplicateCheck = Readonly<{
  jobId: string;
  confidence: ImportDuplicateConfidence;
  disposition: ImportDuplicateDisposition;
  matches: readonly ImportDuplicateMatch[];
  hashCompared: boolean;
  checkedAt: string;
  reviewedAt: string | null;
}>;

export type ImportDuplicateLibraryTrack = Readonly<{
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  duration: number | null;
  format: string;
  fileSize: number;
  mtimeMs: number;
}>;

type ImportDuplicateDetectionManagerOptions = {
  queue: ImportJobQueue;
  staging: ImportStagingManager;
  validatedLookup: (jobId: string) => ValidatedImportPayload<unknown> | null;
  libraryTracks?: () => readonly ImportDuplicateLibraryTrack[] | Promise<readonly ImportDuplicateLibraryTrack[]>;
  hashLibraryTrack?: (track: ImportDuplicateLibraryTrack) => Promise<string | null>;
  databasePath?: string;
  musicDir?: string;
  now?: () => Date;
};

type Fingerprint = Readonly<{
  size: number;
  sha256: string;
}>;

export type ImportDuplicateDetectionErrorCode =
  | 'job_not_found'
  | 'job_not_ready'
  | 'preview_not_ready'
  | 'media_not_validated'
  | 'library_unavailable'
  | 'review_not_available';

export class ImportDuplicateDetectionError extends Error {
  constructor(
    public readonly code: ImportDuplicateDetectionErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ImportDuplicateDetectionError';
  }
}

function cloneCheck(check: ImportDuplicateCheck): ImportDuplicateCheck {
  return {
    ...check,
    matches: check.matches.map(match => ({ ...match, reasons: [...match.reasons] }))
  };
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uploadFileName(job: ImportJob) {
  if (job.source.type !== 'upload') return null;
  const base = path.basename(job.label.trim());
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

function dispositionFor(confidence: ImportDuplicateConfidence): ImportDuplicateDisposition {
  switch (confidence) {
    case 'exact': return 'blocked';
    case 'probable': return 'review';
    case 'possible': return 'notice';
    case 'none': return 'clear';
  }
}

function metadataFor(job: ImportJob): ImportMetadataValues {
  return job.metadataPreview?.effective ?? {
    title: null,
    artist: null,
    album: null,
    albumArtist: null
  };
}

function classifyHeuristic(
  job: ImportJob,
  track: ImportDuplicateLibraryTrack
): { confidence: 'possible' | 'probable' | 'none'; reasons: ImportDuplicateReason[] } {
  const metadata = metadataFor(job);
  return classifyDuplicateSignals({
    title: duplicateTextMatches(metadata.title, track.title),
    artist: duplicateTextMatches(metadata.artist, track.artist),
    album: duplicateTextMatches(metadata.album, track.album),
    duration: duplicateDurationMatches(job.metadataPreview?.durationSeconds, track.duration),
    filename: duplicateTextMatches(uploadFileName(job), track.title)
  });
}

async function hashHandle(handle: Awaited<ReturnType<typeof open>>) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return { sha256: hash.digest('hex'), size: position };
}

async function hashValidationTarget(target: ImportValidationTarget) {
  const handle = await open(target.path, constants.O_RDONLY);
  try {
    const digest = await hashHandle(handle);
    return digest.size === target.size ? digest : null;
  } finally {
    await handle.close();
  }
}

function trackFromRow(row: Record<string, unknown>): ImportDuplicateLibraryTrack {
  return {
    id: cleanString(row.id),
    filePath: cleanString(row.file_path),
    title: cleanString(row.title),
    artist: cleanString(row.artist),
    album: cleanString(row.album),
    albumArtist: cleanString(row.album_artist),
    duration: row.duration == null ? null : nullableNumber(row.duration),
    format: cleanString(row.format),
    fileSize: Math.max(0, Number(row.file_size) || 0),
    mtimeMs: Number(row.mtime_ms) || 0
  };
}

function readLibraryTracks(databasePath: string): ImportDuplicateLibraryTrack[] {
  const db = new DatabaseSync(databasePath, { open: true, readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON;');
    const rows = db.prepare(`
      SELECT id, file_path, title, artist, album, album_artist,
             duration, format, file_size, mtime_ms
      FROM tracks
      ORDER BY id
    `).all() as Record<string, unknown>[];
    return rows.map(trackFromRow).filter(track => Boolean(track.id && track.filePath));
  } finally {
    db.close();
  }
}

export class ImportDuplicateDetectionManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly validatedLookup: (jobId: string) => ValidatedImportPayload<unknown> | null;
  private readonly libraryTracks?: ImportDuplicateDetectionManagerOptions['libraryTracks'];
  private readonly customHashLibraryTrack?: ImportDuplicateDetectionManagerOptions['hashLibraryTrack'];
  private readonly databasePath: string;
  private readonly musicDir: string;
  private readonly now: () => Date;
  private readonly sourceFingerprints = new Map<string, Fingerprint>();
  private readonly checks = new Map<string, ImportDuplicateCheck>();
  private readonly libraryHashCache = new Map<string, string>();

  constructor(options: ImportDuplicateDetectionManagerOptions) {
    this.queue = options.queue;
    this.staging = options.staging;
    this.validatedLookup = options.validatedLookup;
    this.libraryTracks = options.libraryTracks;
    this.customHashLibraryTrack = options.hashLibraryTrack;
    this.databasePath = options.databasePath ?? process.env.HOME_MUSIC_DATABASE_PATH ?? defaultDatabasePath;
    this.musicDir = options.musicDir ?? process.env.MUSIC_DIR ?? '';
    this.now = options.now ?? (() => new Date());
  }

  get(jobId: string) {
    const check = this.checks.get(jobId);
    return check ? cloneCheck(check) : null;
  }

  async captureSource(jobId: string) {
    const existing = this.sourceFingerprints.get(jobId);
    if (existing) return { ...existing };
    const job = this.queue.get(jobId);
    if (!job) throw new ImportDuplicateDetectionError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportDuplicateDetectionError('job_not_ready', 'O job precisa estar pendente para calcular o fingerprint.', 409);
    }

    const fingerprint = await this.staging.inspectPayload(jobId, async target => {
      try {
        return await hashValidationTarget(target);
      } catch {
        return null;
      }
    });
    if (fingerprint) this.sourceFingerprints.set(jobId, fingerprint);
    return fingerprint ? { ...fingerprint } : null;
  }

  async detect(jobId: string) {
    const job = this.requireDetectableJob(jobId);
    const validated = this.validatedLookup(jobId);
    if (!validated) {
      throw new ImportDuplicateDetectionError('media_not_validated', 'Valide tecnicamente a mídia antes de verificar duplicatas.', 409);
    }

    let tracks: readonly ImportDuplicateLibraryTrack[];
    try {
      tracks = this.libraryTracks
        ? await this.libraryTracks()
        : readLibraryTracks(this.databasePath);
    } catch {
      throw new ImportDuplicateDetectionError('library_unavailable', 'Não foi possível consultar a biblioteca para detectar duplicatas.', 503);
    }

    const fingerprints = this.uniqueFingerprints([
      this.sourceFingerprints.get(jobId) ?? null,
      { size: validated.size, sha256: validated.sha256 }
    ]);
    const matches: ImportDuplicateMatch[] = [];
    let hashIncomplete = false;

    for (const track of tracks) {
      const comparableFingerprints = fingerprints.filter(fingerprint => fingerprint.size === track.fileSize);
      let exact = false;
      if (comparableFingerprints.length > 0) {
        const libraryHash = await this.hashTrack(track);
        if (!libraryHash) {
          hashIncomplete = true;
        } else {
          exact = comparableFingerprints.some(fingerprint => fingerprint.sha256 === libraryHash);
        }
      }

      if (exact) {
        matches.push(this.publicMatch(track, 'exact', ['hash']));
        continue;
      }

      const heuristic = classifyHeuristic(job, track);
      if (heuristic.confidence !== 'none') {
        matches.push(this.publicMatch(track, heuristic.confidence, heuristic.reasons));
      }
    }

    matches.sort((left, right) =>
      duplicateConfidenceRank(right.confidence) - duplicateConfidenceRank(left.confidence)
      || left.artist.localeCompare(right.artist, 'pt-BR')
      || left.title.localeCompare(right.title, 'pt-BR')
    );
    const confidence = matches.reduce<ImportDuplicateConfidence>(
      (current, match) => duplicateConfidenceRank(match.confidence) > duplicateConfidenceRank(current)
        ? match.confidence
        : current,
      'none'
    );
    const check: ImportDuplicateCheck = {
      jobId,
      confidence,
      disposition: hashIncomplete && confidence === 'none' ? 'notice' : dispositionFor(confidence),
      matches,
      hashCompared: fingerprints.length > 0 && !hashIncomplete,
      checkedAt: this.now().toISOString(),
      reviewedAt: null
    };
    this.checks.set(jobId, check);
    return cloneCheck(check);
  }

  review(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportDuplicateDetectionError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportDuplicateDetectionError('job_not_ready', 'O job precisa estar pendente para revisar duplicatas.', 409);
    }
    const check = this.checks.get(jobId);
    if (!check || check.disposition !== 'review') {
      throw new ImportDuplicateDetectionError('review_not_available', 'Este job não possui duplicata provável aguardando revisão.', 409);
    }
    const reviewed: ImportDuplicateCheck = {
      ...check,
      reviewedAt: this.now().toISOString()
    };
    this.checks.set(jobId, reviewed);
    return cloneCheck(reviewed);
  }

  isReady(jobId: string) {
    const check = this.checks.get(jobId);
    if (!check) return false;
    if (check.disposition === 'blocked') return false;
    if (check.disposition === 'review') return Boolean(check.reviewedAt);
    return true;
  }

  forgetCheck(jobId: string) {
    return this.checks.delete(jobId);
  }

  forget(jobId: string) {
    this.checks.delete(jobId);
    this.sourceFingerprints.delete(jobId);
  }

  private requireDetectableJob(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportDuplicateDetectionError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportDuplicateDetectionError('job_not_ready', 'O job precisa estar pendente para verificar duplicatas.', 409);
    }
    if (!job.metadataPreview) {
      throw new ImportDuplicateDetectionError('preview_not_ready', 'Gere e revise o preview de metadata antes de verificar duplicatas.', 409);
    }
    return job;
  }

  private uniqueFingerprints(values: Array<Fingerprint | null>) {
    const seen = new Set<string>();
    const result: Fingerprint[] = [];
    for (const value of values) {
      if (!value) continue;
      const key = `${value.size}:${value.sha256}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  private publicMatch(
    track: ImportDuplicateLibraryTrack,
    confidence: ImportDuplicateMatch['confidence'],
    reasons: readonly ImportDuplicateReason[]
  ): ImportDuplicateMatch {
    return {
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.duration,
      format: track.format,
      confidence,
      reasons: [...reasons]
    };
  }

  private async hashTrack(track: ImportDuplicateLibraryTrack) {
    if (this.customHashLibraryTrack) return this.customHashLibraryTrack(track);
    const key = `${track.id}:${track.filePath}:${track.fileSize}:${track.mtimeMs}`;
    const cached = this.libraryHashCache.get(key);
    if (cached) {
      this.libraryHashCache.delete(key);
      this.libraryHashCache.set(key, cached);
      return cached;
    }
    if (!this.musicDir.trim()) return null;

    try {
      const root = await resolveLibraryRoot(this.musicDir);
      const safe = await openRegularFileInside(root, track.filePath);
      try {
        const before = await safe.handle.stat();
        if (before.size !== track.fileSize) return null;
        const digest = await hashHandle(safe.handle);
        const after = await safe.handle.stat();
        if (digest.size !== after.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return null;
        this.libraryHashCache.set(key, digest.sha256);
        while (this.libraryHashCache.size > MAX_HASH_CACHE_ITEMS) {
          const oldest = this.libraryHashCache.keys().next().value as string | undefined;
          if (!oldest) break;
          this.libraryHashCache.delete(oldest);
        }
        return digest.sha256;
      } finally {
        await safe.handle.close();
      }
    } catch {
      return null;
    }
  }
}
