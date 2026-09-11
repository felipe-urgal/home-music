import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serviceWorker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function functionSource(name: string, nextName: string) {
  const start = serviceWorker.indexOf(`async function ${name}`);
  const end = serviceWorker.indexOf(`async function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return serviceWorker.slice(start, end);
}

describe('PWA service worker cache policy', () => {
  it('versiona o cache estático para recuperar instalações existentes', () => {
    expect(serviceWorker).toContain("const CACHE_NAME = `${CACHE_PREFIX}v4`;");
  });

  it('publica o shell somente depois de preparar todos os bundles referenciados', () => {
    const snapshot = functionSource('cacheShellSnapshot', 'warmStaticCache');
    const assets = snapshot.indexOf('await cache.addAll(requiredUrls);');
    const shell = snapshot.indexOf('await cache.put(SHELL_URL, shellResponse);');

    expect(assets).toBeGreaterThanOrEqual(0);
    expect(shell).toBeGreaterThan(assets);
  });

  it('usa a mesma atualização coerente no install e no refresh pós-montagem', () => {
    const warm = functionSource('warmStaticCache', 'refreshCachedShell');
    const refresh = functionSource('refreshCachedShell', 'cacheFirstNavigation');

    expect(warm).toContain('await cacheShellSnapshot(cache, shellResponse');
    expect(warm).toContain("'/manifest.webmanifest'");
    expect(warm).toContain("'/favicon.svg'");
    expect(refresh).toContain('await cacheShellSnapshot(cache, response.clone());');
    expect(refresh).not.toContain('cache.put(SHELL_URL, response.clone())');
  });

  it('ativa o worker novo sem esperar o shell antigo fechar', () => {
    expect(serviceWorker).toMatch(/await warmStaticCache\(\);\s+await self\.skipWaiting\(\);/);
    expect(serviceWorker).toContain('await self.clients.claim();');
  });

  it('limpa caches estáticos antigos sem remover downloads offline v2', () => {
    expect(serviceWorker).toContain("const OFFLINE_AUDIO_CACHE_PREFIX = 'home-music-offline-audio-v2-';");
    expect(serviceWorker).toMatch(/name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
    expect(serviceWorker).toContain('name === LEGACY_OFFLINE_AUDIO_CACHE_NAME');
    expect(serviceWorker).not.toMatch(/name\.startsWith\(OFFLINE_AUDIO_CACHE_PREFIX\)/);
  });
});
