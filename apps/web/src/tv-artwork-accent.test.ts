import { describe, expect, it } from 'vitest';
import { normalizeTvAccent } from './useTvArtworkAccent';

function channel(value: number) {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function contrastWithWhite({ r, g, b }: { r: number; g: number; b: number }) {
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (luminance + 0.05);
}

describe('normalizeTvAccent', () => {
  it.each([
    { r: 255, g: 235, b: 40 },
    { r: 60, g: 230, b: 170 },
    { r: 30, g: 220, b: 245 }
  ])('mantém pelo menos 3:1 de contraste com ícones brancos para $r/$g/$b', rgb => {
    expect(contrastWithWhite(normalizeTvAccent(rgb))).toBeGreaterThanOrEqual(3);
  });
});
