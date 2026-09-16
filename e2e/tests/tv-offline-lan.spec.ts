import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const username = 'playwright';
const password = ['playwright', 'password', '2026'].join('-');
const receiverRoot = path.resolve(fileURLToPath(new URL('../../apps/web/dist-tv-receiver/', import.meta.url)));

async function login(page: Page, url: string) {
  await page.goto(url);
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}

async function seedOfflineTracks(page: Page, titles: string[]) {
  return page.evaluate(async requestedTitles => {
    const libraryResponse = await fetch('/api/library');
    const library = await libraryResponse.json() as { tracks: Array<Record<string, unknown>> };
    const tracks = library.tracks.filter(track => requestedTitles.includes(String(track.title)));
    const userId = localStorage.getItem('home-music:offline-user-id:v1');
    if (!userId || tracks.length !== requestedTitles.length) throw new Error('offline fixture incomplete');
    const cache = await caches.open(`home-music-offline-audio-v2-${encodeURIComponent(userId)}`);
    const records = [];
    for (const track of tracks) {
      const streamPath = `/api/tracks/${encodeURIComponent(String(track.id))}/stream`;
      const response = await fetch(streamPath);
      const blob = await response.clone().blob();
      await cache.put(streamPath, response);
      records.push({ track, size: blob.size, mimeType: blob.type || 'audio/wav', downloadedAt: new Date().toISOString() });
      Object.assign(track, { fixtureBytes: Array.from(new Uint8Array(await blob.arrayBuffer())), fixtureMimeType: blob.type || 'audio/wav' });
    }
    localStorage.setItem(`home-music-offline-tracks:v2:${encodeURIComponent(userId)}`.replace('home-music-offline-', 'home-music:offline-'), JSON.stringify(records));
    localStorage.setItem(`home-music-offline-references:v1:${encodeURIComponent(userId)}`.replace('home-music-offline-', 'home-music:offline-'), JSON.stringify({
      version: 1,
      individualTrackIds: tracks.map(track => String(track.id)),
      collections: []
    }));
    return tracks.map(track => ({
      id: String(track.id),
      title: String(track.title),
      artist: String(track.artist || 'Artista desconhecido'),
      bytes: track.fixtureBytes as number[],
      mimeType: String(track.fixtureMimeType)
    }));
  }, titles);
}

function lanFixture() {
  const version = 'home-music-lan-remote-v1';
  const sessionId = 'session_1234567890abcdef';
  const secret = Array.from({ length: 16 }, (_, index) => (index * 17).toString(16).padStart(2, '0')).join('');
  const sessionToken = ['token', '1234567890abcdef'].join('_');
  const expiresAt = Date.now() + 90_000;
  const messages: Array<{ cursor: number; from: 'remote' | 'tv'; body: unknown }> = [];
  const requests: Array<{ method: string; path: string; origin: string | null }> = [];
  let cursor = 0;
  const qrText = `home-music://tv-lan?version=${version}&host=192.168.1.40&port=43123&session=${sessionId}&secret=${secret}&expires=${expiresAt}`;

  const route = async (requestRoute: Route) => {
    const request = requestRoute.request();
    const url = new URL(request.url());
    const origin = request.headers().origin || 'http://127.0.0.1:8791';
    requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, origin: request.headers().origin || null });
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true'
    };
    if (request.method() === 'OPTIONS') return requestRoute.fulfill({ status: 204, headers });
    if (url.pathname === '/receiver/bootstrap') {
      return requestRoute.fulfill({ status: 200, headers, json: { version, sessionId, sessionToken, expiresAt, signalingBase: 'http://127.0.0.1:43123' } });
    }
    if (url.pathname === '/challenge') {
      const clientNonce = url.searchParams.get('clientNonce') || '';
      return requestRoute.fulfill({ status: 200, headers, json: { sessionId, clientNonce, tvNonce: 'tvnonce_1234567890', expiresAt: Math.min(expiresAt, Date.now() + 60_000) } });
    }
    if (url.pathname === '/join') {
      const body = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
      const proofMessage = [version, body.sessionId, body.clientNonce, body.tvNonce, body.expiresAt].join('\n');
      const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update(proofMessage).digest('base64url');
      if (body.proof !== expected) return requestRoute.fulfill({ status: 401, headers, json: { error: 'invalid proof' } });
      return requestRoute.fulfill({ status: 200, headers, json: { sessionToken, expiresAt } });
    }
    if (url.pathname === '/signals' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}') as { from: 'remote' | 'tv' };
      messages.push({ cursor: ++cursor, from: body.from, body });
      return requestRoute.fulfill({ status: 204, headers });
    }
    if (url.pathname === '/signals') {
      const role = url.searchParams.get('role');
      const after = Number(url.searchParams.get('cursor') || 0);
      return requestRoute.fulfill({
        status: 200,
        headers,
        json: { cursor, messages: messages.filter(message => message.cursor > after && message.from !== role).map(message => message.body) }
      });
    }
    return requestRoute.fulfill({ status: 404, headers });
  };
  const binding = async (input: { url: string; method: string; body?: string }) => {
    const url = new URL(input.url);
    requests.push({ method: input.method, path: `${url.pathname}${url.search}`, origin: 'http://127.0.0.1:8791' });
    if (url.pathname === '/challenge') {
      const clientNonce = url.searchParams.get('clientNonce') || '';
      return { status: 200, json: { sessionId, clientNonce, tvNonce: 'tvnonce_1234567890', expiresAt: Math.min(expiresAt, Date.now() + 60_000) } };
    }
    if (url.pathname === '/join') {
      const body = JSON.parse(input.body || '{}') as Record<string, unknown>;
      const proofMessage = [version, body.sessionId, body.clientNonce, body.tvNonce, body.expiresAt].join('\n');
      const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update(proofMessage).digest('base64url');
      return body.proof === expected
        ? { status: 200, json: { sessionToken, expiresAt } }
        : { status: 401, json: { error: 'invalid proof' } };
    }
    if (url.pathname === '/signals' && input.method === 'POST') {
      const body = JSON.parse(input.body || '{}') as { from: 'remote' | 'tv' };
      messages.push({ cursor: ++cursor, from: body.from, body });
      return { status: 204 };
    }
    if (url.pathname === '/signals') {
      const role = url.searchParams.get('role');
      const after = Number(url.searchParams.get('cursor') || 0);
      return {
        status: 200,
        json: { cursor, messages: messages.filter(message => message.cursor > after && message.from !== role).map(message => message.body) }
      };
    }
    if (url.pathname === '/close') return { status: 200, json: {} };
    return { status: 404, json: { error: 'not found' } };
  };
  return { qrText, route, binding, diagnostics: () => ({ cursor, messages, requests }) };
}

async function serveReceiver(context: BrowserContext, fixtureRoute: (route: Route) => Promise<void>) {
  await context.route('http://127.0.0.1:43123/**', fixtureRoute);
  await context.route('http://192.168.1.40:43123/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/receiver/') || url.pathname === '/receiver/bootstrap') return fixtureRoute(route);
    const relative = url.pathname === '/receiver/' ? 'tv-offline-receiver.html' : url.pathname.replace(/^\/receiver\//, '');
    const file = path.resolve(receiverRoot, relative);
    if (!file.startsWith(receiverRoot)) return route.fulfill({ status: 404 });
    const body = await readFile(file);
    const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ status: 200, contentType, body });
  });
}

test('PWA envia faixas e controla o receiver LAN sem backend', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/');
  await page.context().grantPermissions(['local-network-access'], { origin: 'http://127.0.0.1:8791' });
  const tracks = await seedOfflineTracks(page, ['E2E Zeta', 'E2E Zulu']);
  const fixture = lanFixture();
  const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvContext.newPage();
  await serveReceiver(tvContext, fixture.route);
  await tv.goto('http://192.168.1.40:43123/receiver/');
  await expect(tv.locator('.tv-offline-receiver')).toBeVisible({ timeout: 10_000 });
  await expect(tv.locator('.tv-offline-receiver__status')).toContainText(/Receiver offline pronto|Aguardando o celular/);

  let backendRequests = 0;
  await page.context().route('http://192.168.1.40:43123/**', fixture.route);
  await page.context().route('http://127.0.0.1:43123/**', fixture.route);
  await page.context().route('**/offline-audio/**', route => {
    const trackId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    const track = tracks.find(item => item.id === trackId);
    return track
      ? route.fulfill({ status: 200, contentType: track.mimeType, body: Buffer.from(track.bytes) })
      : route.fulfill({ status: 404 });
  });
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  });
  const phoneContext = page.context();
  await phoneContext.route('**/api/**', route => { backendRequests += 1; return route.abort('connectionrefused'); });
  await phoneContext.exposeFunction('__homeMusicLanFixture', fixture.binding);
  await phoneContext.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (!rawUrl.startsWith('http://192.168.1.40:43123/')) return nativeFetch(input, init);
      const request = input instanceof Request ? input : null;
      const bridge = (window as unknown as {
        __homeMusicLanFixture: (value: { url: string; method: string; body?: string }) =>
          Promise<{ status: number; json?: unknown }>;
      }).__homeMusicLanFixture;
      const result = await bridge({
        url: rawUrl,
        method: init?.method || request?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined
      });
      return new Response(result.json === undefined ? null : JSON.stringify(result.json), {
        status: result.status,
        headers: result.json === undefined ? undefined : { 'Content-Type': 'application/json' }
      });
    };
  });
  await page.close();
  page = await phoneContext.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Conectar à TV', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conectar à TV', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Conectar à TV por QR' })).toBeVisible();
  await page.getByLabel('Conteúdo do QR').fill(fixture.qrText);
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  try {
    await expect(page.getByText(/TV conectada em/)).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    const [phoneText, tvText] = await Promise.all([
      page.locator('body').innerText(),
      tv.locator('body').innerText()
    ]);
    throw new Error([
      error instanceof Error ? error.message : String(error),
      `Phone UI: ${phoneText}`,
      `TV UI: ${tvText}`,
      `Signaling: ${JSON.stringify(fixture.diagnostics())}`
    ].join('\n\n'));
  }
  const requestsAtConnection = backendRequests;

  const first = tracks[0]!;
  await page.getByRole('button', {
    name: `Enviar para a TV ${first.title}, ${first.artist}`,
    exact: true
  }).click();
  await expect(tv.locator('.tv-offline-receiver__now-playing strong')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => tv.locator('audio').evaluateAll(elements => (
    elements.some(element => (element as HTMLAudioElement).src.startsWith('blob:'))
  ))).toBe(true);

  await expect(page.getByTestId('mini-player')).toBeVisible();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(tv.getByRole('button', { name: 'Continuar', exact: true })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Tocar', exact: true }).click();
  await expect(tv.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible({ timeout: 5_000 });

  const firstBlobSources = await tv.locator('audio').evaluateAll(elements => (
    elements.map(element => (element as HTMLAudioElement).src).filter(src => src.startsWith('blob:'))
  ));
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect.poll(async () => tv.locator('audio').evaluateAll(elements => (
    elements.map(element => (element as HTMLAudioElement).src).filter(src => src.startsWith('blob:'))
  ))).not.toEqual(firstBlobSources);

  await page.getByTestId('mini-player').locator('.mini-player__main').click();
  const progress = page.getByLabel('Progresso da música');
  await expect(progress).toBeVisible();
  const duration = await progress.evaluate(element => Number((element as HTMLInputElement).max));
  if (duration > 0.5) {
    const target = Math.min(duration - 0.1, Math.max(0.2, duration / 2));
    await progress.fill(String(target));
    await expect.poll(async () => tv.locator('audio').evaluateAll(elements => {
      const active = elements.find(element => !(element as HTMLAudioElement).paused && Number.isFinite((element as HTMLAudioElement).currentTime));
      return active ? (active as HTMLAudioElement).currentTime : 0;
    })).toBeGreaterThan(Math.max(0, target - 0.5));
  }

  expect(backendRequests).toBe(requestsAtConnection);
  expect(await page.locator('audio').evaluateAll(elements => elements.every(element => (element as HTMLAudioElement).paused))).toBe(true);
  await tvContext.close();
});
