const CACHE_PREFIX = 'home-music-static-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_AUDIO_CACHE_PREFIX = 'home-music-offline-audio-v2-';
const LEGACY_OFFLINE_AUDIO_CACHE_NAME = 'home-music-offline-audio-v1';
const OFFLINE_AUDIO_PREFIX = '/offline-audio/';
const CAPABILITY_REQUEST = 'HOME_MUSIC_GET_CAPABILITIES';
const CAPABILITY_RESPONSE = 'HOME_MUSIC_CAPABILITIES';
const SHELL_URL = '/';
const REVALIDATED_STATIC = new Set(['/manifest.webmanifest', '/favicon.svg']);
const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const offlineUserByClient = new Map();

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isHashedAsset(pathname) {
  return pathname.startsWith('/assets/');
}

function isCacheableResponse(response) {
  return response.ok && (response.type === 'basic' || response.type === 'default');
}

function offlineTrackId(pathname) {
  if (!pathname.startsWith(OFFLINE_AUDIO_PREFIX)) return null;
  const encoded = pathname.slice(OFFLINE_AUDIO_PREFIX.length);
  if (!encoded || encoded.includes('/')) return null;
  try {
    const trackId = decodeURIComponent(encoded);
    return TRACK_ID_RE.test(trackId) ? trackId : null;
  } catch {
    return null;
  }
}

function offlineAudioCacheName(userId) {
  return `${OFFLINE_AUDIO_CACHE_PREFIX}${encodeURIComponent(userId)}`;
}

function sourceAudioUrl(trackId) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

function parseOfflineRange(value, size) {
  if (!value) return undefined;
  if (!Number.isFinite(size) || size <= 0 || value.includes(',')) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function offlineAudioHeaders(contentType, size) {
  return {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': contentType,
    'Content-Length': String(size)
  };
}

function offlineUnavailable() {
  return new Response('Download offline não encontrado neste usuário.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function serveOfflineAudio(request, userId, trackId) {
  const cache = await caches.open(offlineAudioCacheName(userId));
  const cached = await cache.match(sourceAudioUrl(trackId));
  if (!cached) return offlineUnavailable();

  const blob = await cached.blob();
  const contentType = cached.headers.get('content-type') || blob.type || 'application/octet-stream';
  const headers = offlineAudioHeaders(contentType, blob.size);

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  const range = parseOfflineRange(request.headers.get('range'), blob.size);
  if (range === null) {
    const invalidHeaders = new Headers(headers);
    invalidHeaders.set('Content-Range', `bytes */${blob.size}`);
    invalidHeaders.set('Content-Length', '0');
    return new Response(null, { status: 416, headers: invalidHeaders });
  }

  if (range === undefined) return new Response(blob, { status: 200, headers });

  const partial = blob.slice(range.start, range.end + 1, contentType);
  const partialHeaders = new Headers(headers);
  partialHeaders.set('Content-Length', String(partial.size));
  partialHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${blob.size}`);
  return new Response(partial, { status: 206, headers: partialHeaders });
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
        .filter(name => (
          (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) ||
          name === LEGACY_OFFLINE_AUDIO_CACHE_NAME
        ))
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== CAPABILITY_REQUEST) return;

  const clientId = typeof event.source?.id === 'string' ? event.source.id : null;
  const userId = typeof event.data?.userId === 'string' && USER_ID_RE.test(event.data.userId)
    ? event.data.userId
    : null;

  if (clientId) {
    if (userId) offlineUserByClient.set(clientId, userId);
    else offlineUserByClient.delete(clientId);
  }

  event.ports?.[0]?.postMessage({
    type: CAPABILITY_RESPONSE,
    version: 3,
    offlineAudio: true
  });
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const downloadedTrackId = offlineTrackId(url.pathname);
  if (downloadedTrackId && (request.method === 'GET' || request.method === 'HEAD')) {
    const userId = event.clientId ? offlineUserByClient.get(event.clientId) : null;
    event.respondWith(userId
      ? serveOfflineAudio(request, userId, downloadedTrackId)
      : Promise.resolve(offlineUnavailable())
    );
    return;
  }

  if (request.method !== 'GET') return;

  // Conteúdo autenticado continua fora do cache estático da PWA.
  // Downloads explícitos usam caches separados por usuário. A rota virtual contém
  // somente a faixa; o cache é escolhido pelo escopo do client/tab que fez a requisição.
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
