import { useEffect, useMemo, useState } from 'react';
import type { Track } from '@home-music/shared';
import { buildArtworkFallback } from './artwork-utils';

type Rgb = {
  r: number;
  g: number;
  b: number;
};

export type TvArtworkAccent = {
  color: string;
  rgb: string;
};

const DEFAULT_ACCENT: TvArtworkAccent = {
  color: '#ff9238',
  rgb: '255 146 56'
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgb(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const numeric = Number.parseInt(match[1], 16);
  return {
    r: numeric >> 16 & 255,
    g: numeric >> 8 & 255,
    b: numeric & 255
  };
}

function rgbToHsl({ r, g, b }: Rgb) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return { hue: 0, saturation: 0, lightness };

  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);

  let hue = 0;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  return { hue: hue / 6, saturation, lightness };
}

function hueToRgb(p: number, q: number, rawHue: number) {
  let hue = rawHue;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  if (saturation === 0) {
    const value = Math.round(lightness * 255);
    return { r: value, g: value, b: value };
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return {
    r: Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, hue) * 255),
    b: Math.round(hueToRgb(p, q, hue - 1 / 3) * 255)
  };
}

function normalizeAccent(rgb: Rgb) {
  const hsl = rgbToHsl(rgb);
  return hslToRgb(
    hsl.hue,
    clamp(Math.max(hsl.saturation, 0.46), 0.46, 0.88),
    clamp(hsl.lightness, 0.46, 0.60)
  );
}

function accentFromRgb(rgb: Rgb): TvArtworkAccent {
  const normalized = normalizeAccent(rgb);
  return {
    color: `rgb(${normalized.r} ${normalized.g} ${normalized.b})`,
    rgb: `${normalized.r} ${normalized.g} ${normalized.b}`
  };
}

function fallbackAccent(track?: Track): TvArtworkAccent {
  if (!track) return DEFAULT_ACCENT;
  const fallback = buildArtworkFallback(track);
  const rgb = hexToRgb(fallback.palette.glow) ?? hexToRgb(fallback.palette.surface);
  return rgb ? accentFromRgb(rgb) : DEFAULT_ACCENT;
}

function chooseArtworkAccent(data: Uint8ClampedArray): TvArtworkAccent | null {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (let index = 0; index < data.length; index += 16) {
    const alpha = data[index + 3];
    if (alpha < 180) continue;

    const rgb = { r: data[index], g: data[index + 1], b: data[index + 2] };
    const { saturation, lightness } = rgbToHsl(rgb);
    if (lightness < 0.08 || lightness > 0.92) continue;

    const key = `${rgb.r >> 4}-${rgb.g >> 4}-${rgb.b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    const weight = saturation > 0.68 && lightness > 0.24 && lightness < 0.76 ? 2 : 1;
    bucket.count += weight;
    bucket.r += rgb.r * weight;
    bucket.g += rgb.g * weight;
    bucket.b += rgb.b * weight;
    buckets.set(key, bucket);
  }

  let best: { score: number; rgb: Rgb } | null = null;

  for (const bucket of buckets.values()) {
    if (bucket.count < 2) continue;

    const rgb = {
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count)
    };
    const { saturation, lightness } = rgbToHsl(rgb);
    const brightnessWeight = 1 - Math.min(0.82, Math.abs(lightness - 0.52));
    const score = bucket.count * (0.56 + saturation * 1.7) * brightnessWeight;

    if (!best || score > best.score) best = { score, rgb };
  }

  return best ? accentFromRgb(best.rgb) : null;
}

function trackCoverUrl(track?: Track) {
  if (!track?.hasCover) return null;
  const version = track.coverVersion ? `?v=${encodeURIComponent(track.coverVersion)}` : '';
  return `/api/tracks/${encodeURIComponent(track.id)}/cover${version}`;
}

export function useTvArtworkAccent(track?: Track) {
  const coverUrl = useMemo(() => trackCoverUrl(track), [track]);
  const [accent, setAccent] = useState<TvArtworkAccent>(() => fallbackAccent(track));

  useEffect(() => {
    let cancelled = false;
    const fallback = fallbackAccent(track);
    setAccent(fallback);

    if (!coverUrl) return () => { cancelled = true; };

    const image = new Image();
    image.decoding = 'async';

    image.onload = () => {
      if (cancelled) return;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const sampled = context.getImageData(0, 0, canvas.width, canvas.height);
        const extracted = chooseArtworkAccent(sampled.data);
        if (!cancelled && extracted) setAccent(extracted);
      } catch {
        // Capa indisponível para leitura: mantém a paleta de fallback.
      }
    };

    image.onerror = () => {
      if (!cancelled) setAccent(fallback);
    };

    image.src = coverUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [coverUrl, track]);

  return accent;
}
