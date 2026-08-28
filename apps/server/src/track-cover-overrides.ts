import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AdminTrackCoverResponse, Track } from '@home-music/shared';

export const COVER_OVERRIDE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp'
] as const;
export const MAX_COVER_OVERRIDE_BYTES = 8 * 1024 * 1024;
export const MAX_COVER_DIMENSION = 4096;
export const MAX_COVER_PIXELS = 16 * 1024 * 1024;

type CoverContentType = typeof COVER_OVERRIDE_CONTENT_TYPES[number];
type Row = Record<string, unknown>;

type CoverOverrideMetadata = NonNullable<AdminTrackCoverResponse['override']>;

export type CoverOverridePayload = CoverOverrideMetadata & {
  data: Buffer;
};

export class CoverOverrideValidationError extends Error {
  constructor(
    public readonly statusCode: 400 | 413 | 415,
    message: string
  ) {
    super(message);
    this.name = 'CoverOverrideValidationError';
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0;
}

function normalizeContentType(value: string) {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function isAllowedContentType(value: string): value is CoverContentType {
  return (COVER_OVERRIDE_CONTENT_TYPES as readonly string[]).includes(value);
}

function readUInt24LE(data: Buffer, offset: number) {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function pngDimensions(data: Buffer) {
  if (data.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!data.subarray(0, 8).equals(signature)) return null;
  if (data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') return null;
  return {
    contentType: 'image/png' as const,
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf
]);

function jpegDimensions(data: Buffer) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;

  while (offset < data.length) {
    while (offset < data.length && data[offset] !== 0xff) offset += 1;
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) break;

    const marker = data[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;

    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) break;
      return {
        contentType: 'image/jpeg' as const,
        width: data.readUInt16BE(offset + 5),
        height: data.readUInt16BE(offset + 3)
      };
    }
    offset += length;
  }

  return null;
}

function webpDimensions(data: Buffer) {
  if (data.length < 30) return null;
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') return null;
  const declaredSize = data.readUInt32LE(4) + 8;
  if (declaredSize > data.length) return null;

  const chunk = data.toString('ascii', 12, 16);
  const chunkSize = data.readUInt32LE(16);
  if (20 + chunkSize > data.length) return null;

  if (chunk === 'VP8X' && chunkSize >= 10) {
    return {
      contentType: 'image/webp' as const,
      width: 1 + readUInt24LE(data, 24),
      height: 1 + readUInt24LE(data, 27)
    };
  }

  if (chunk === 'VP8L' && chunkSize >= 5 && data[20] === 0x2f) {
    const b0 = data[21];
    const b1 = data[22];
    const b2 = data[23];
    const b3 = data[24];
    return {
      contentType: 'image/webp' as const,
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10)
    };
  }

  if (chunk === 'VP8 ' && chunkSize >= 10) {
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
    return {
      contentType: 'image/webp' as const,
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff
    };
  }

  return null;
}

export function inspectCoverOverride(data: Buffer, declaredContentType: string) {
  if (!Buffer.isBuffer(data) || data.byteLength === 0) {
    throw new CoverOverrideValidationError(400, 'Arquivo de capa obrigatório.');
  }
  if (data.byteLength > MAX_COVER_OVERRIDE_BYTES) {
    throw new CoverOverrideValidationError(413, 'A capa deve ter no máximo 8 MiB.');
  }

  const contentType = normalizeContentType(declaredContentType);
  if (!isAllowedContentType(contentType)) {
    throw new CoverOverrideValidationError(415, 'Formato de capa não suportado. Use JPEG, PNG ou WebP.');
  }

  const detected = pngDimensions(data) ?? jpegDimensions(data) ?? webpDimensions(data);
  if (!detected) {
    throw new CoverOverrideValidationError(415, 'Arquivo de capa inválido ou corrompido.');
  }
  if (detected.contentType !== contentType) {
    throw new CoverOverrideValidationError(415, 'O conteúdo da imagem não corresponde ao formato informado.');
  }
  if (
    detected.width <= 0 || detected.height <= 0
    || detected.width > MAX_COVER_DIMENSION || detected.height > MAX_COVER_DIMENSION
    || detected.width * detected.height > MAX_COVER_PIXELS
  ) {
    throw new CoverOverrideValidationError(
      413,
      `A capa deve ter no máximo ${MAX_COVER_DIMENSION}×${MAX_COVER_DIMENSION} pixels e 16 MP.`
    );
  }

  const hash = createHash('sha256').update(data).digest('hex');
  return {
    contentType: detected.contentType,
    width: detected.width,
    height: detected.height,
    sizeBytes: data.byteLength,
    hash,
    version: hash.slice(0, 16)
  };
}

function metadataFromRow(row: Row): CoverOverrideMetadata {
  const hash = stringValue(row.content_hash);
  return {
    contentType: stringValue(row.content_type),
    width: numberValue(row.width),
    height: numberValue(row.height),
    sizeBytes: numberValue(row.size_bytes),
    updatedAt: stringValue(row.updated_at),
    version: hash.slice(0, 16)
  };
}

export class TrackCoverOverrideStore {
  private readonly db: DatabaseSync;
  private overrides = new Map<string, CoverOverrideMetadata>();

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS track_cover_overrides (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg', 'image/png', 'image/webp')),
        width INTEGER NOT NULL CHECK(width > 0 AND width <= ${MAX_COVER_DIMENSION}),
        height INTEGER NOT NULL CHECK(height > 0 AND height <= ${MAX_COVER_DIMENSION}),
        size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= ${MAX_COVER_OVERRIDE_BYTES}),
        content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
        data BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(width * height <= ${MAX_COVER_PIXELS})
      );

      CREATE INDEX IF NOT EXISTS idx_track_cover_overrides_updated_at
      ON track_cover_overrides(updated_at DESC);
    `);
    this.refresh();
  }

  close() {
    this.db.close();
  }

  refresh() {
    const rows = this.db.prepare(`
      SELECT track_id, content_type, width, height, size_bytes, content_hash, updated_at
      FROM track_cover_overrides;
    `).all() as Row[];
    this.overrides = new Map(rows.map(row => [stringValue(row.track_id), metadataFromRow(row)]));
  }

  resolveTrack<T extends Track>(track: T): T {
    const override = this.overrides.get(track.id);
    if (!override) return track;
    return {
      ...track,
      hasCover: true,
      coverVersion: override.version
    };
  }

  getStatus(trackId: string): AdminTrackCoverResponse | null {
    const row = this.db.prepare(`
      SELECT t.id, t.has_cover,
             o.content_type, o.width, o.height, o.size_bytes, o.content_hash, o.updated_at
      FROM tracks t
      LEFT JOIN track_cover_overrides o ON o.track_id = t.id
      WHERE t.id = ?
      LIMIT 1;
    `).get(trackId) as Row | undefined;
    if (!row) return null;

    const override = row.updated_at == null ? null : metadataFromRow(row);
    return {
      trackId: stringValue(row.id),
      physicalHasCover: Boolean(row.has_cover),
      effectiveHasCover: Boolean(row.has_cover) || Boolean(override),
      override
    };
  }

  read(trackId: string): CoverOverridePayload | null {
    const row = this.db.prepare(`
      SELECT content_type, width, height, size_bytes, content_hash, data, updated_at
      FROM track_cover_overrides
      WHERE track_id = ?
      LIMIT 1;
    `).get(trackId) as Row | undefined;
    if (!row) return null;

    const raw = row.data;
    if (!(raw instanceof Uint8Array)) {
      throw new Error('Override de capa corrompido no SQLite.');
    }
    return {
      ...metadataFromRow(row),
      data: Buffer.from(raw)
    };
  }

  save(trackId: string, data: Buffer, declaredContentType: string): AdminTrackCoverResponse | null {
    const inspected = inspectCoverOverride(data, declaredContentType);
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const exists = Boolean(this.db.prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1;').get(trackId));
      if (!exists) {
        this.db.exec('ROLLBACK;');
        return null;
      }

      const updatedAt = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO track_cover_overrides(
          track_id, content_type, width, height, size_bytes, content_hash, data, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET
          content_type = excluded.content_type,
          width = excluded.width,
          height = excluded.height,
          size_bytes = excluded.size_bytes,
          content_hash = excluded.content_hash,
          data = excluded.data,
          updated_at = excluded.updated_at;
      `).run(
        trackId,
        inspected.contentType,
        inspected.width,
        inspected.height,
        inspected.sizeBytes,
        inspected.hash,
        data,
        updatedAt
      );
      this.db.exec('COMMIT;');
      this.refresh();
      return this.getStatus(trackId);
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  clear(trackId: string): AdminTrackCoverResponse | null {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const exists = Boolean(this.db.prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1;').get(trackId));
      if (!exists) {
        this.db.exec('ROLLBACK;');
        return null;
      }
      this.db.prepare('DELETE FROM track_cover_overrides WHERE track_id = ?;').run(trackId);
      this.db.exec('COMMIT;');
      this.refresh();
      return this.getStatus(trackId);
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
}
