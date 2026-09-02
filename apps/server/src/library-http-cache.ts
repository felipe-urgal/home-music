import { createHash } from 'node:crypto';
import {
  brotliCompress,
  constants as zlibConstants,
  gzip
} from 'node:zlib';
import type { LibraryService } from './library-service.js';

export const LIBRARY_COMPRESSION_MIN_BYTES = 1024;

export type LibraryContentEncoding = 'br' | 'gzip' | 'identity';

type LibrarySource = Pick<LibraryService, 'listPublicTracks' | 'status'>;

type CompressedBodies = {
  br?: Promise<Buffer>;
  gzip?: Promise<Buffer>;
};

export type LibraryHttpSnapshot = {
  revision: number;
  etag: string;
  body: Buffer;
  compressed: CompressedBodies;
};

type ProjectedTracks = {
  revision: number;
  tracks: ReturnType<LibraryService['listPublicTracks']>;
};

type CachedSnapshot = LibraryHttpSnapshot & {
  statusKey: string;
};

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

function quality(value: string | undefined) {
  if (value === undefined) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function acceptedEncodings(value: string | string[] | undefined) {
  const result = new Map<string, number>();
  for (const part of headerValue(value).split(',')) {
    const [rawName, ...parameters] = part.trim().toLowerCase().split(';');
    const name = rawName?.trim();
    if (!name) continue;
    const qParameter = parameters
      .map(parameter => parameter.trim())
      .find(parameter => parameter.startsWith('q='));
    result.set(name, quality(qParameter?.slice(2)));
  }
  return result;
}

function encodingQuality(encodings: Map<string, number>, encoding: 'br' | 'gzip') {
  if (encodings.has(encoding)) return encodings.get(encoding) ?? 0;
  return encodings.get('*') ?? 0;
}

function normalizeEntityTag(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

function compressBrotli(input: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    brotliCompress(input, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 4
      }
    }, (error, output) => {
      if (error) reject(error);
      else resolve(output);
    });
  });
}

function compressGzip(input: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    gzip(input, { level: 6 }, (error, output) => {
      if (error) reject(error);
      else resolve(output);
    });
  });
}

export function matchesIfNoneMatch(
  value: string | string[] | undefined,
  currentEtag: string
) {
  const candidates = headerValue(value);
  if (!candidates) return false;
  const normalizedCurrent = normalizeEntityTag(currentEtag);
  return candidates.split(',').some(candidate => {
    const tag = candidate.trim();
    return tag === '*' || normalizeEntityTag(tag) === normalizedCurrent;
  });
}

export function selectLibraryContentEncoding(
  value: string | string[] | undefined,
  bodyBytes: number
): LibraryContentEncoding {
  if (bodyBytes < LIBRARY_COMPRESSION_MIN_BYTES) return 'identity';
  const encodings = acceptedEncodings(value);
  const br = encodingQuality(encodings, 'br');
  const gzipQuality = encodingQuality(encodings, 'gzip');
  if (br <= 0 && gzipQuality <= 0) return 'identity';
  return br >= gzipQuality ? 'br' : 'gzip';
}

export class LibraryHttpSnapshotCache {
  private projectedTracks: ProjectedTracks | null = null;
  private cachedSnapshot: CachedSnapshot | null = null;

  constructor(private readonly library: LibrarySource) {}

  snapshot(): LibraryHttpSnapshot {
    const status = this.library.status();
    if (!this.projectedTracks || this.projectedTracks.revision !== status.revision) {
      this.projectedTracks = {
        revision: status.revision,
        tracks: this.library.listPublicTracks()
      };
    }

    const statusKey = JSON.stringify(status);
    if (
      this.cachedSnapshot
      && this.cachedSnapshot.revision === status.revision
      && this.cachedSnapshot.statusKey === statusKey
    ) {
      return this.cachedSnapshot;
    }

    const body = Buffer.from(JSON.stringify({
      tracks: this.projectedTracks.tracks,
      ...status
    }));
    const digest = createHash('sha256')
      .update(body)
      .digest('base64url')
      .slice(0, 24);
    const snapshot: CachedSnapshot = {
      revision: status.revision,
      statusKey,
      etag: `W/"library-r${status.revision}-${digest}"`,
      body,
      compressed: {}
    };
    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  bodyFor(snapshot: LibraryHttpSnapshot, encoding: LibraryContentEncoding) {
    if (encoding === 'identity') return Promise.resolve(snapshot.body);
    const cached = snapshot.compressed[encoding];
    if (cached) return cached;

    const compressed = encoding === 'br'
      ? compressBrotli(snapshot.body)
      : compressGzip(snapshot.body);
    snapshot.compressed[encoding] = compressed;
    return compressed;
  }
}
