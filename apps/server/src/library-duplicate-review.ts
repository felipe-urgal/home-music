import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminLibraryDuplicateCandidate,
  AdminLibraryDuplicateConfidence,
  AdminLibraryDuplicateIgnoreResponse,
  AdminLibraryDuplicateReason,
  AdminLibraryDuplicateReviewResponse,
  AdminLibraryDuplicateTrack
} from '@home-music/shared';
import {
  classifyDuplicateSignals,
  duplicateConfidenceRank,
  duplicateDurationMatches,
  duplicateTextMatches,
  normalizeDuplicateText
} from './duplicate-comparison.js';
import { openRegularFileInside, resolveLibraryRoot } from './security.js';

const HASH_BUFFER_BYTES = 64 * 1024;
const MAX_HASH_CACHE_ITEMS = 2_048;

type Row = Record<string, unknown>;

export type LibraryDuplicateTrack = Readonly<{
  id: string;
  filePath: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  format: string;
  fileSize: number;
  mtimeMs: number;
}>;

type LibraryDuplicateReviewOptions = {
  databasePath: string;
  musicDir: string;
  libraryTracks?: () => readonly LibraryDuplicateTrack[] | Promise<readonly LibraryDuplicateTrack[]>;
  hashTrack?: (track: LibraryDuplicateTrack) => Promise<string | null>;
  isHidden?: (trackId: string) => boolean;
  now?: () => Date;
};

type CandidateDraft = {
  left: LibraryDuplicateTrack;
  right: LibraryDuplicateTrack;
  confidence: AdminLibraryDuplicateConfidence;
  reasons: Set<AdminLibraryDuplicateReason>;
};

export class LibraryDuplicateReviewError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'LibraryDuplicateReviewError';
  }
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trackFromRow(row: Row): LibraryDuplicateTrack {
  return {
    id: cleanString(row.id),
    filePath: cleanString(row.file_path),
    title: cleanString(row.title),
    artist: cleanString(row.artist),
    album: cleanString(row.album),
    duration: nullableNumber(row.duration),
    format: cleanString(row.format),
    fileSize: Math.max(0, Number(row.file_size) || 0),
    mtimeMs: Number(row.mtime_ms) || 0
  };
}

function pairIds(leftId: string, rightId: string): [string, string] {
  return leftId.localeCompare(rightId) <= 0
    ? [leftId, rightId]
    : [rightId, leftId];
}

export function libraryDuplicatePairKey(leftId: string, rightId: string) {
  const [first, second] = pairIds(leftId, rightId);
  return `${first}:${second}`;
}

function filenameStem(filePath: string) {
  const base = path.basename(filePath);
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

function publicRelativePath(musicDir: string, filePath: string) {
  if (!musicDir.trim()) return path.basename(filePath);
  const root = path.resolve(musicDir);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  if (!relative || relative === '.') return path.basename(filePath);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return path.basename(filePath);
  }
  return relative.split(path.sep).join('/');
}

function publicTrack(track: LibraryDuplicateTrack, musicDir: string): AdminLibraryDuplicateTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSeconds: track.duration,
    format: track.format,
    sizeBytes: track.fileSize,
    relativePath: publicRelativePath(musicDir, track.filePath)
  };
}

function candidateSort(left: AdminLibraryDuplicateCandidate, right: AdminLibraryDuplicateCandidate) {
  return Number(left.ignored) - Number(right.ignored)
    || duplicateConfidenceRank(right.confidence) - duplicateConfidenceRank(left.confidence)
    || left.tracks[0].artist.localeCompare(right.tracks[0].artist, 'pt-BR')
    || left.tracks[0].title.localeCompare(right.tracks[0].title, 'pt-BR')
    || left.key.localeCompare(right.key, 'pt-BR');
}

async function sha256Handle(handle: Awaited<ReturnType<typeof openRegularFileInside>>['handle']) {
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

export class LibraryDuplicateReviewStore {
  private readonly db: DatabaseSync;
  private readonly musicDir: string;
  private readonly libraryTracks?: LibraryDuplicateReviewOptions['libraryTracks'];
  private readonly customHashTrack?: LibraryDuplicateReviewOptions['hashTrack'];
  private readonly isHidden: (trackId: string) => boolean;
  private readonly now: () => Date;
  private readonly hashCache = new Map<string, string>();
  private libraryRootPromise: Promise<string | null> | null = null;

  constructor(options: LibraryDuplicateReviewOptions) {
    this.musicDir = options.musicDir;
    this.libraryTracks = options.libraryTracks;
    this.customHashTrack = options.hashTrack;
    this.isHidden = options.isHidden ?? (() => false);
    this.now = options.now ?? (() => new Date());
    this.db = new DatabaseSync(options.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_duplicate_ignores (
        track_a_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        track_b_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (track_a_id, track_b_id),
        CHECK (track_a_id < track_b_id)
      );
    `);
  }

  close() {
    this.db.close();
  }

  async check(): Promise<AdminLibraryDuplicateReviewResponse> {
    if (!this.musicDir.trim() && !this.libraryTracks) {
      throw new LibraryDuplicateReviewError(409, 'Biblioteca não está configurada para revisão de duplicatas.');
    }

    const allTracks = await this.readTracks();
    const tracks = allTracks.filter(track => track.id && track.filePath && !this.isHidden(track.id));
    const byId = new Map(tracks.map(track => [track.id, track]));
    const candidates = new Map<string, CandidateDraft>();

    const addHeuristicPair = (left: LibraryDuplicateTrack, right: LibraryDuplicateTrack) => {
      if (left.id === right.id) return;
      const key = libraryDuplicatePairKey(left.id, right.id);
      const existing = candidates.get(key);
      if (existing?.confidence === 'exact') return;

      const leftFilename = filenameStem(left.filePath);
      const rightFilename = filenameStem(right.filePath);
      const classified = classifyDuplicateSignals({
        title: duplicateTextMatches(left.title, right.title),
        artist: duplicateTextMatches(left.artist, right.artist),
        album: duplicateTextMatches(left.album, right.album),
        duration: duplicateDurationMatches(left.duration, right.duration),
        filename:
          duplicateTextMatches(leftFilename, rightFilename)
          || duplicateTextMatches(leftFilename, right.title)
          || duplicateTextMatches(rightFilename, left.title)
      });
      if (classified.confidence === 'none') return;

      const [firstId] = pairIds(left.id, right.id);
      const orderedLeft = left.id === firstId ? left : right;
      const orderedRight = left.id === firstId ? right : left;
      if (!existing || duplicateConfidenceRank(classified.confidence) > duplicateConfidenceRank(existing.confidence)) {
        candidates.set(key, {
          left: orderedLeft,
          right: orderedRight,
          confidence: classified.confidence,
          reasons: new Set(classified.reasons)
        });
        return;
      }
      for (const reason of classified.reasons) existing.reasons.add(reason);
    };

    const addBucketPairs = (buckets: Map<string, LibraryDuplicateTrack[]>) => {
      for (const bucket of buckets.values()) {
        for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
            addHeuristicPair(bucket[leftIndex], bucket[rightIndex]);
          }
        }
      }
    };

    const titleBuckets = new Map<string, LibraryDuplicateTrack[]>();
    const artistAlbumBuckets = new Map<string, LibraryDuplicateTrack[]>();
    const filenameBuckets = new Map<string, LibraryDuplicateTrack[]>();

    for (const track of tracks) {
      const title = normalizeDuplicateText(track.title);
      if (title) this.pushBucket(titleBuckets, title, track);

      const artist = normalizeDuplicateText(track.artist);
      const album = normalizeDuplicateText(track.album);
      if (artist && album) this.pushBucket(artistAlbumBuckets, `${artist}\u0000${album}`, track);

      const filename = normalizeDuplicateText(filenameStem(track.filePath));
      if (filename) this.pushBucket(filenameBuckets, filename, track);
    }

    addBucketPairs(titleBuckets);
    addBucketPairs(artistAlbumBuckets);
    addBucketPairs(filenameBuckets);

    for (const track of tracks) {
      const filename = normalizeDuplicateText(filenameStem(track.filePath));
      if (!filename) continue;
      for (const titleMatch of titleBuckets.get(filename) ?? []) {
        addHeuristicPair(track, titleMatch);
      }
    }

    let hashComplete = true;
    const sizeBuckets = new Map<number, LibraryDuplicateTrack[]>();
    for (const track of tracks) {
      if (track.fileSize > 0) this.pushBucket(sizeBuckets, track.fileSize, track);
    }

    for (const bucket of sizeBuckets.values()) {
      if (bucket.length < 2) continue;
      const hashes = new Map<string, LibraryDuplicateTrack[]>();
      for (const track of bucket) {
        const digest = await this.hashTrack(track);
        if (!digest) {
          hashComplete = false;
          continue;
        }
        this.pushBucket(hashes, digest, track);
      }

      for (const exactGroup of hashes.values()) {
        if (exactGroup.length < 2) continue;
        for (let leftIndex = 0; leftIndex < exactGroup.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < exactGroup.length; rightIndex += 1) {
            const left = exactGroup[leftIndex];
            const right = exactGroup[rightIndex];
            const [firstId] = pairIds(left.id, right.id);
            const orderedLeft = left.id === firstId ? left : right;
            const orderedRight = left.id === firstId ? right : left;
            candidates.set(libraryDuplicatePairKey(left.id, right.id), {
              left: orderedLeft,
              right: orderedRight,
              confidence: 'exact',
              reasons: new Set(['hash'])
            });
          }
        }
      }
    }

    const ignored = this.ignoredPairKeys();
    const publicCandidates = [...candidates.entries()].map(([key, candidate]): AdminLibraryDuplicateCandidate => ({
      key,
      confidence: candidate.confidence,
      reasons: [...candidate.reasons],
      tracks: [
        publicTrack(candidate.left, this.musicDir),
        publicTrack(candidate.right, this.musicDir)
      ],
      ignored: ignored.has(key)
    }));
    publicCandidates.sort(candidateSort);

    const active = publicCandidates.filter(candidate => !candidate.ignored);
    return {
      checkedAt: this.now().toISOString(),
      hashComplete,
      counts: {
        reviewable: active.length,
        exact: active.filter(candidate => candidate.confidence === 'exact').length,
        probable: active.filter(candidate => candidate.confidence === 'probable').length,
        possible: active.filter(candidate => candidate.confidence === 'possible').length,
        ignored: publicCandidates.length - active.length
      },
      candidates: publicCandidates
    };
  }

  setIgnored(trackIds: readonly [string, string], ignored: boolean): AdminLibraryDuplicateIgnoreResponse {
    const [trackA, trackB] = pairIds(trackIds[0], trackIds[1]);
    if (!trackA || !trackB || trackA === trackB) {
      throw new LibraryDuplicateReviewError(400, 'Par de músicas inválido para revisão de duplicatas.');
    }

    if (ignored) {
      const rows = this.db.prepare('SELECT id FROM tracks WHERE id IN (?, ?);').all(trackA, trackB) as Row[];
      if (new Set(rows.map(row => cleanString(row.id)).filter(Boolean)).size !== 2) {
        throw new LibraryDuplicateReviewError(404, 'Uma das músicas não está mais disponível na biblioteca.');
      }
      this.db.prepare(`
        INSERT INTO library_duplicate_ignores(track_a_id, track_b_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(track_a_id, track_b_id) DO UPDATE SET created_at = excluded.created_at;
      `).run(trackA, trackB, this.now().toISOString());
    } else {
      this.db.prepare(`
        DELETE FROM library_duplicate_ignores
        WHERE track_a_id = ? AND track_b_id = ?;
      `).run(trackA, trackB);
    }

    return { key: libraryDuplicatePairKey(trackA, trackB), ignored };
  }

  private async readTracks() {
    if (this.libraryTracks) return [...await this.libraryTracks()];
    const rows = this.db.prepare(`
      SELECT id, file_path, title, artist, album, duration, format, file_size, mtime_ms
      FROM tracks
      ORDER BY id;
    `).all() as Row[];
    return rows.map(trackFromRow);
  }

  private ignoredPairKeys() {
    const rows = this.db.prepare(`
      SELECT track_a_id, track_b_id
      FROM library_duplicate_ignores;
    `).all() as Row[];
    return new Set(rows.map(row => libraryDuplicatePairKey(cleanString(row.track_a_id), cleanString(row.track_b_id))));
  }

  private pushBucket<K>(map: Map<K, LibraryDuplicateTrack[]>, key: K, track: LibraryDuplicateTrack) {
    const bucket = map.get(key);
    if (bucket) bucket.push(track);
    else map.set(key, [track]);
  }

  private async resolveLibraryRoot() {
    if (!this.musicDir.trim()) return null;
    if (!this.libraryRootPromise) {
      this.libraryRootPromise = resolveLibraryRoot(this.musicDir).catch(() => null);
    }
    return this.libraryRootPromise;
  }

  private async hashTrack(track: LibraryDuplicateTrack) {
    if (this.customHashTrack) return this.customHashTrack(track);
    const key = `${track.id}:${track.filePath}:${track.fileSize}:${track.mtimeMs}`;
    const cached = this.hashCache.get(key);
    if (cached) {
      this.hashCache.delete(key);
      this.hashCache.set(key, cached);
      return cached;
    }

    const root = await this.resolveLibraryRoot();
    if (!root) return null;
    try {
      const safe = await openRegularFileInside(root, track.filePath);
      try {
        const before = await safe.handle.stat();
        if (before.size !== track.fileSize) return null;
        const digest = await sha256Handle(safe.handle);
        const after = await safe.handle.stat();
        if (digest.size !== after.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return null;
        this.hashCache.set(key, digest.sha256);
        while (this.hashCache.size > MAX_HASH_CACHE_ITEMS) {
          const oldest = this.hashCache.keys().next().value as string | undefined;
          if (!oldest) break;
          this.hashCache.delete(oldest);
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
