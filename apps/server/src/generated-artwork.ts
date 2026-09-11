import { deflateSync } from 'node:zlib';
import {
  ARTWORK_FALLBACK_VERSION,
  artworkFallbackHash,
  buildArtworkFallback,
  type ArtworkFallbackIdentity,
  type ArtworkFallbackTrack
} from '@home-music/shared/artwork';

export const GENERATED_ARTWORK_SIZE = 512;
export const GENERATED_ARTWORK_CONTENT_TYPE = 'image/png' as const;

function hexColor(value: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`Cor de artwork inválida: ${value}`);
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ] as const;
}

function rgbaColor(value: string) {
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (!match) throw new Error(`Cor de glow inválida: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.allocUnsafe(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function renderPixels(identity: ArtworkFallbackIdentity, size: number) {
  const [surfaceR, surfaceG, surfaceB] = hexColor(identity.palette.surface);
  const [baseR, baseG, baseB] = hexColor(identity.palette.base);
  const [glowR, glowG, glowB, glowAlpha] = rgbaColor(identity.palette.glow);
  const seedHash = artworkFallbackHash(`${identity.seed}:${identity.label}:v${identity.version}`);
  const discCenter = size * 0.825;
  const discRadius = size * 0.095;
  const centerHole = size * 0.02;
  const raw = Buffer.alloc((size * 4 + 1) * size);

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4;
      const diagonal = Math.min(1, (x + y) / (size * 1.48));
      let r = surfaceR * (1 - diagonal) + baseR * diagonal;
      let g = surfaceG * (1 - diagonal) + baseG * diagonal;
      let b = surfaceB * (1 - diagonal) + baseB * diagonal;

      const gx = x / size - 0.24;
      const gy = y / size - 0.18;
      const glowDistance = Math.sqrt(gx * gx + gy * gy) / 0.52;
      if (glowDistance < 1) {
        const alpha = (1 - glowDistance) * glowAlpha;
        r = r * (1 - alpha) + glowR * alpha;
        g = g * (1 - alpha) + glowG * alpha;
        b = b * (1 - alpha) + glowB * alpha;
      }

      const dx = x + 0.5 - discCenter;
      const dy = y + 0.5 - discCenter;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(distance - discRadius) <= Math.max(1, size / 256)) {
        r = r * 0.62 + 255 * 0.38;
        g = g * 0.62 + 255 * 0.38;
        b = b * 0.62 + 255 * 0.38;
      } else if (distance <= centerHole) {
        r = r * 0.38 + 255 * 0.62;
        g = g * 0.38 + 255 * 0.62;
        b = b * 0.38 + 255 * 0.62;
      }

      const cell = Math.max(8, Math.floor(size / 16));
      const cellX = Math.floor(x / cell);
      const cellY = Math.floor(y / cell);
      const bit = (seedHash >>> ((cellX + cellY * 5) % 31)) & 1;
      if (bit && x > size * 0.34 && x < size * 0.66 && y > size * 0.38 && y < size * 0.62) {
        r = r * 0.88 + 245 * 0.12;
        g = g * 0.88 + 249 * 0.12;
        b = b * 0.88 + 252 * 0.12;
      }

      raw[offset] = clampByte(r);
      raw[offset + 1] = clampByte(g);
      raw[offset + 2] = clampByte(b);
      raw[offset + 3] = 255;
    }
  }

  return raw;
}

export function renderGeneratedArtworkPng(track: ArtworkFallbackTrack, requestedSize = GENERATED_ARTWORK_SIZE) {
  const size = Math.max(64, Math.min(1024, Math.round(requestedSize)));
  const identity = buildArtworkFallback(track);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const data = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(renderPixels(identity, size), { level: 9 })),
    pngChunk('IEND')
  ]);

  return {
    contentType: GENERATED_ARTWORK_CONTENT_TYPE,
    data,
    identity,
    generatorVersion: ARTWORK_FALLBACK_VERSION
  };
}
