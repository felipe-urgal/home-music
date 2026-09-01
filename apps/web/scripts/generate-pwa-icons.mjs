import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const COLORS = {
  background: [11, 24, 36, 255],
  blue: [30, 139, 232, 255],
  white: [240, 247, 252, 255],
  groove: [109, 163, 200, 255],
  baseline: [40, 119, 173, 255],
  transparent: [0, 0, 0, 0]
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createSurface(size, color) {
  const pixels = new Uint8Array(size * size * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset);
  return { size, pixels };
}

function putPixel(surface, x, y, color) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= surface.size || iy >= surface.size) return;
  surface.pixels.set(color, ((iy * surface.size) + ix) * 4);
}

function fillCircle(surface, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(surface.size - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(surface.size - 1, Math.ceil(cy + radius));
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) + (dy * dy) <= radiusSquared) putPixel(surface, x, y, color);
    }
  }
}

function strokeCircle(surface, cx, cy, radius, width, color) {
  const outer = radius + (width / 2);
  const inner = Math.max(0, radius - (width / 2));
  const outerSquared = outer * outer;
  const innerSquared = inner * inner;
  for (let y = Math.max(0, Math.floor(cy - outer)); y <= Math.min(surface.size - 1, Math.ceil(cy + outer)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - outer)); x <= Math.min(surface.size - 1, Math.ceil(cx + outer)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distanceSquared = (dx * dx) + (dy * dy);
      if (distanceSquared <= outerSquared && distanceSquared >= innerSquared) putPixel(surface, x, y, color);
    }
  }
}

function distanceToSegmentSquared(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lengthSquared = (vx * vx) + (vy * vy);
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (((px - x1) * vx) + ((py - y1) * vy)) / lengthSquared));
  const dx = px - (x1 + (t * vx));
  const dy = py - (y1 + (t * vy));
  return (dx * dx) + (dy * dy);
}

function strokeLine(surface, x1, y1, x2, y2, width, color) {
  const radius = width / 2;
  const radiusSquared = radius * radius;
  for (let y = Math.max(0, Math.floor(Math.min(y1, y2) - radius)); y <= Math.min(surface.size - 1, Math.ceil(Math.max(y1, y2) + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(Math.min(x1, x2) - radius)); x <= Math.min(surface.size - 1, Math.ceil(Math.max(x1, x2) + radius)); x += 1) {
      if (distanceToSegmentSquared(x, y, x1, y1, x2, y2) <= radiusSquared) putPixel(surface, x, y, color);
    }
  }
}

function fillRoundedSquare(surface, inset, radius, color) {
  const left = inset;
  const top = inset;
  const right = surface.size - inset - 1;
  const bottom = surface.size - inset - 1;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const nearestX = Math.max(left + radius, Math.min(x, right - radius));
      const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
      const dx = x - nearestX;
      const dy = y - nearestY;
      if ((dx * dx) + (dy * dy) <= radius * radius) putPixel(surface, x, y, color);
    }
  }
}

function drawHomeMusicIcon(size, mode) {
  const surface = createSurface(size, mode === 'any' ? COLORS.transparent : COLORS.background);
  const scale = size / 512;
  const px = value => value * scale;
  const width = value => Math.max(1, Math.round(value * scale));

  if (mode === 'any') {
    fillRoundedSquare(surface, Math.max(1, Math.round(size * 0.025)), Math.round(size * 0.22), COLORS.background);
  }

  strokeLine(surface, px(132), px(244), px(256), px(132), width(38), COLORS.blue);
  strokeLine(surface, px(256), px(132), px(380), px(244), width(38), COLORS.blue);
  strokeLine(surface, px(153), px(231), px(153), px(363), width(26), COLORS.blue);
  strokeLine(surface, px(359), px(231), px(359), px(363), width(26), COLORS.blue);
  fillCircle(surface, px(256), px(300), px(91), COLORS.white);
  strokeCircle(surface, px(256), px(300), px(66), width(5), COLORS.groove);
  strokeCircle(surface, px(256), px(300), px(44), width(5), COLORS.groove);
  fillCircle(surface, px(256), px(300), px(26), COLORS.blue);
  fillCircle(surface, px(256), px(300), px(8), COLORS.background);
  strokeLine(surface, px(176), px(384), px(336), px(384), width(14), COLORS.baseline);
  return surface;
}

function encodePng(surface) {
  const { size, pixels } = surface;
  const rowLength = (size * 4) + 1;
  const raw = Buffer.alloc(rowLength * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    const sourceOffset = y * size * 4;
    Buffer.from(pixels.buffer, pixels.byteOffset + sourceOffset, size * 4).copy(raw, rowOffset + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(appRoot, 'public', 'icons');
await mkdir(outputDirectory, { recursive: true });

const outputs = [
  ['app-icon-192.png', 192, 'any'],
  ['app-icon-512.png', 512, 'any'],
  ['app-icon-maskable-192.png', 192, 'maskable'],
  ['app-icon-maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'touch']
];

for (const [filename, size, mode] of outputs) {
  await writeFile(path.join(outputDirectory, filename), encodePng(drawHomeMusicIcon(size, mode)));
}
