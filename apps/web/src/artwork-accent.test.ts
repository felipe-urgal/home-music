import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARTWORK_ACCENT,
  artworkAccentFromPixels,
  mixArtworkAccents
} from './artwork-accent';

function pixels(colors: Array<[number, number, number, number?]>) {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
}

function rgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  };
}

describe('artwork accent', () => {
  it('usa a família de cor dominante da capa e normaliza para boa leitura no fundo escuro', () => {
    const accent = artworkAccentFromPixels(pixels([
      ...Array.from({ length: 18 }, () => [22, 58, 158, 255] as [number, number, number, number]),
      ...Array.from({ length: 5 }, () => [224, 92, 48, 255] as [number, number, number, number])
    ]));

    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    const color = rgb(accent ?? DEFAULT_ARTWORK_ACCENT);
    expect(color.b).toBeGreaterThan(color.r);
    expect(color.b).toBeGreaterThan(color.g);
    expect(Math.max(color.r, color.g, color.b)).toBeGreaterThanOrEqual(128);
  });

  it('ignora capas praticamente neutras para preservar o fallback âmbar', () => {
    const accent = artworkAccentFromPixels(pixels([
      [28, 30, 31, 255],
      [122, 124, 126, 255],
      [224, 225, 226, 255]
    ]));

    expect(accent).toBeNull();
  });

  it('ignora pixels transparentes', () => {
    const accent = artworkAccentFromPixels(pixels([
      [22, 58, 158, 0],
      [224, 92, 48, 20]
    ]));

    expect(accent).toBeNull();
  });

  it('mistura suavemente as cores durante o crossfade', () => {
    expect(mixArtworkAccents('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixArtworkAccents('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixArtworkAccents('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});
