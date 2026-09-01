import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicFile = (path: string) => new URL(`../public/${path}`, import.meta.url);
const readText = (path: string) => readFileSync(publicFile(path), 'utf8');

function pngDimensions(path: string) {
  const bytes = readFileSync(publicFile(path));
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

describe('PWA identity assets', () => {
  it('declara ícones any e maskable em tamanhos instaláveis', () => {
    const manifest = JSON.parse(readText('manifest.webmanifest')) as {
      icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    };

    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: '/icons/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }),
      expect.objectContaining({ src: '/icons/app-icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' }),
      expect.objectContaining({ src: '/icons/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' })
    ]));
  });

  it.each([
    ['icons/app-icon-192.png', 192],
    ['icons/app-icon-512.png', 512],
    ['icons/app-icon-maskable-192.png', 192],
    ['icons/app-icon-maskable-512.png', 512],
    ['icons/apple-touch-icon.png', 180]
  ])('mantém %s como PNG quadrado no tamanho esperado', (path, size) => {
    expect(pngDimensions(path)).toEqual({ width: size, height: size });
  });

  it('expõe identidade específica para iOS/Safari no shell HTML', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('rel="mask-icon" href="/safari-pinned-tab.svg" color="#1e8be8"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Home Music"');
  });

  it('revalida os assets de identidade no cache estático sem migrar o cache de áudio', () => {
    const sw = readText('sw.js');
    expect(sw).toContain("const CACHE_NAME = 'home-music-static-v3'");
    expect(sw).toContain("const OFFLINE_AUDIO_CACHE = 'home-music-offline-audio-v2'");

    for (const asset of [
      '/manifest.webmanifest',
      '/favicon.svg',
      '/safari-pinned-tab.svg',
      '/icons/app-icon-192.png',
      '/icons/app-icon-512.png',
      '/icons/app-icon-maskable-192.png',
      '/icons/app-icon-maskable-512.png',
      '/icons/apple-touch-icon.png'
    ]) {
      expect(sw).toContain(`'${asset}'`);
    }
  });
});
