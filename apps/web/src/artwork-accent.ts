export const DEFAULT_ARTWORK_ACCENT = '#ff9f49';

const ARTWORK_SAMPLE_SIZE = 32;
const MIN_PIXEL_ALPHA = 160;
const MIN_COLOR_SATURATION = 0.12;

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Hsl = {
  h: number;
  s: number;
  l: number;
};

type ColorBucket = {
  weight: number;
  r: number;
  g: number;
  b: number;
};

const artworkAccentCache = new Map<string, string | null>();
const artworkAccentRequests = new Map<string, Promise<string | null>>();

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function componentToHex(value: number) {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }: Rgb) {
  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function hexToRgb(value: string): Rgb | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value.trim());
  if (!match) return null;

  return {
    r: Number.parseInt(match[1] ?? '0', 16),
    g: Number.parseInt(match[2] ?? '0', 16),
    b: Number.parseInt(match[3] ?? '0', 16)
  };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation,
    l: lightness
  };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hue = h / 60;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 1) [red, green] = [chroma, x];
  else if (hue < 2) [red, green] = [x, chroma];
  else if (hue < 3) [green, blue] = [chroma, x];
  else if (hue < 4) [green, blue] = [x, chroma];
  else if (hue < 5) [red, blue] = [x, chroma];
  else [red, blue] = [chroma, x];

  const match = l - chroma / 2;
  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255
  };
}

function normalizeAccent(rgb: Rgb) {
  const hsl = rgbToHsl(rgb);
  if (hsl.s < MIN_COLOR_SATURATION) return null;

  return rgbToHex(hslToRgb({
    h: hsl.h,
    s: clamp(hsl.s, 0.58, 0.84),
    l: clamp(hsl.l, 0.5, 0.62)
  }));
}

export function artworkAccentFromPixels(pixels: ArrayLike<number>) {
  const buckets = new Map<string, ColorBucket>();

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < MIN_PIXEL_ALPHA) continue;

    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const saturation = max === 0 ? 0 : chroma / max;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    if (saturation < MIN_COLOR_SATURATION || luminance < 0.06 || luminance > 0.95) continue;

    const centeredLuminance = 1 - Math.min(1, Math.abs(luminance - 0.56) / 0.5);
    const weight = (0.08 + saturation * saturation * 2.8 + (chroma / 255) * 0.55)
      * (0.78 + centeredLuminance * 0.3);
    const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };

    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  }

  let winner: ColorBucket | null = null;
  for (const bucket of buckets.values()) {
    if (!winner || bucket.weight > winner.weight) winner = bucket;
  }
  if (!winner || winner.weight <= 0) return null;

  return normalizeAccent({
    r: winner.r / winner.weight,
    g: winner.g / winner.weight,
    b: winner.b / winner.weight
  });
}

export function mixArtworkAccents(from: string, to: string, progress: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  if (!start || !end) return progress >= 0.5 ? to : from;

  const amount = clamp(progress, 0, 1);
  return rgbToHex({
    r: start.r + (end.r - start.r) * amount,
    g: start.g + (end.g - start.g) * amount,
    b: start.b + (end.b - start.b) * amount
  });
}

function accentFromImage(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = ARTWORK_SAMPLE_SIZE;
  canvas.height = ARTWORK_SAMPLE_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE);
  return artworkAccentFromPixels(
    context.getImageData(0, 0, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE).data
  );
}

export function loadArtworkAccent(url: string): Promise<string | null> {
  if (artworkAccentCache.has(url)) {
    return Promise.resolve(artworkAccentCache.get(url) ?? null);
  }

  const pending = artworkAccentRequests.get(url);
  if (pending) return pending;

  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  const request = new Promise<string | null>(resolve => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const accent = accentFromImage(image);
        artworkAccentCache.set(url, accent);
        resolve(accent);
      } catch {
        artworkAccentCache.set(url, null);
        resolve(null);
      }
    };
    image.onerror = () => {
      artworkAccentCache.set(url, null);
      resolve(null);
    };
    image.src = url;
  }).finally(() => {
    artworkAccentRequests.delete(url);
  });

  artworkAccentRequests.set(url, request);
  return request;
}
