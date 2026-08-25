const CACHE_PREFIX = 'home-music-static-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_URL = '/';
const REVALIDATED_STATIC = new Set(['/manifest.webmanifest', '/favicon.svg']);

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isHashedAsset(pathname) {
  return pathname.startsWith('/assets/');
}

function isCacheableResponse(response) {
  return response.ok && (response.type === 'basic' || response.type === 'default');
}

function assetUrlsFromHtml(html) {
  const urls = new Set();
  const pattern = /(?:src|href)=["'](\/assets\/[^"']+)["']/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && isHashedAsset(url.pathname)) {
        urls.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // Ignora referências inválidas; o shell continua utilizável com os demais assets.
    }
  }

  return [...urls];
}

async function warmStaticCache() {
  const cache = await caches.open(CACHE_NAME);
  const shellResponse = await fetch(SHELL_URL, { cache: 'no-store' });
  if (!isCacheableResponse(shellResponse)) {
    throw new Error(`Não foi possível preparar o shell da PWA: HTTP ${shellResponse.status}`);
  }

  const html = await shellResponse.clone().text();
  await cache.put(SHELL_URL, shellResponse);
  await cache.addAll([
    '/manifest.webmanifest',
    '/favicon.svg',
    ...assetUrlsFromHtml(html)
  ]);
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const cachedShell = await cache.match(SHELL_URL);
    if (cachedShell) return cachedShell;

    return new Response('Home Music indisponível offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(async response => {
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    void refresh;
    return cached;
  }

  const response = await refresh;
  if (response) return response;

  return new Response('', { status: 503 });
}

self.addEventListener('install', event => {
  event.waitUntil(warmStaticCache());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Conteúdo autenticado nunca entra no cache estático da PWA.
  // Isso inclui login/sessão, biblioteca, capas privadas e streams de áudio.
  if (isApiPath(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isHashedAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (REVALIDATED_STATIC.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
