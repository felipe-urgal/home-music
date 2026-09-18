import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const username = 'playwright';
const password = ['playwright', 'password', '2026'].join('-');
const receiverRoot = path.resolve(fileURLToPath(new URL('../../apps/web/dist-tv-receiver/', import.meta.url)));
const bridgeRoot = path.resolve(fileURLToPath(new URL('../../android-tv/app/src/main/assets/', import.meta.url)));
const iPhoneUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required']
  }
});

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
      displayArtist: String(track.albumArtist || track.artist || 'Artista desconhecido'),
      album: String(track.album || 'Álbum desconhecido'),
      bytes: track.fixtureBytes as number[],
      mimeType: String(track.fixtureMimeType)
    }));
  }, titles);
}

function lanFixture() {
  const version = 'home-music-lan-remote-v2';
  const sessionId = 'session_1234567890abcdef';
  const secret = Array.from({ length: 16 }, (_, index) => (index * 17).toString(16).padStart(2, '0')).join('');
  const sessionToken = ['token', '1234567890abcdef'].join('_');
  const expiresAt = Date.now() + 90_000;
  const messages: Array<{ cursor: number; from: 'remote' | 'tv'; body: unknown }> = [];
  const requests: Array<{ method: string; path: string; frameUrl: string }> = [];
  let cursor = 0;
  const qrText = `home-music://tv-lan?version=${version}&host=192.168.1.40&port=43123&session=${sessionId}&secret=${secret}&expires=${expiresAt}`;

  const route = async (requestRoute: Route) => {
    const request = requestRoute.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, frameUrl: request.frame().url() });
    const origin = request.headers().origin || 'http://127.0.0.1:8791';
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
    if (url.pathname === '/close') return requestRoute.fulfill({ status: 200, headers, json: {} });
    return requestRoute.fulfill({ status: 404, headers, json: { error: 'not found' } });
  };

  return { qrText, route, diagnostics: () => ({ cursor, messages, requests: [...requests] }) };
}

async function serveLan(context: BrowserContext, fixtureRoute: (route: Route) => Promise<void>) {
  await context.route('http://127.0.0.1:43123/**', fixtureRoute);
  await context.route('http://192.168.1.40:43123/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/bridge' || url.pathname === '/bridge.js') {
      const file = path.resolve(bridgeRoot, url.pathname === '/bridge' ? 'bridge.html' : 'bridge.js');
      const body = await readFile(file);
      return route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
        body
      });
    }
    if (url.pathname.startsWith('/receiver/') && url.pathname !== '/receiver/bootstrap') {
      const relative = url.pathname === '/receiver/' ? 'tv-offline-receiver.html' : url.pathname.replace(/^\/receiver\//, '');
      const file = path.resolve(receiverRoot, relative);
      if (!file.startsWith(receiverRoot)) return route.fulfill({ status: 404 });
      const body = await readFile(file);
      const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
      return route.fulfill({ status: 200, contentType, body });
    }
    return fixtureRoute(route);
  });
}

test('iOS usa bridge LAN só para signaling e mantém mídia no DataChannel', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/');
  const tracks = await seedOfflineTracks(page, ['E2E Zeta']);
  const fixture = lanFixture();

  const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvContext.newPage();
  await serveLan(tvContext, fixture.route);
  await tv.goto('http://192.168.1.40:43123/receiver/');
  await expect(tv.locator('.tv-offline-receiver')).toBeVisible({ timeout: 10_000 });
  await expect(tv.locator('.tv-offline-receiver__status')).toContainText(/Receiver offline pronto|Aguardando o celular/);

  const phoneContext = page.context();
  await serveLan(phoneContext, fixture.route);
  await phoneContext.route('**/offline-audio/**', route => {
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

  let backendRequests = 0;
  await phoneContext.route('**/api/**', route => { backendRequests += 1; return route.abort('connectionrefused'); });
  await phoneContext.addInitScript(userAgent => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'iPhone' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  }, iPhoneUserAgent);

  await page.close();
  page = await phoneContext.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Conectar à TV', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conectar à TV', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Conectar à TV por QR' })).toBeVisible();
  await page.getByLabel('Conteúdo do QR').fill(fixture.qrText);

  const bridgePagePromise = phoneContext.waitForEvent('page');
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  const bridgePage = await bridgePagePromise;

  await expect(page.getByText(/TV conectada (?:em|e pronta)/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => bridgePage.isClosed()).toBe(true);
  const diagnosticsAtConnection = fixture.diagnostics();
  expect(diagnosticsAtConnection.requests.some(request => request.path.startsWith('/challenge?'))).toBe(true);
  expect(diagnosticsAtConnection.requests.some(request => request.path === '/join')).toBe(true);
  expect(diagnosticsAtConnection.requests.some(request => request.path.startsWith('/signals?role=remote'))).toBe(true);
  expect(diagnosticsAtConnection.requests.some(request => request.path === '/close?role=remote')).toBe(false);
  expect(diagnosticsAtConnection.requests.filter(request => request.path.startsWith('/challenge?') || request.path === '/join')
    .every(request => request.frameUrl.startsWith('http://192.168.1.40:43123/bridge'))).toBe(true);

  const lanRequestCountAtConnection = diagnosticsAtConnection.requests.length;
  const backendRequestsAtConnection = backendRequests;
  const first = tracks[0]!;
  await page.getByRole('button', {
    name: `Enviar para a TV ${first.title}, ${first.artist}`,
    exact: true
  }).click();
  await expect(tv.locator('.tv-offline-receiver__details h1')).toHaveText(first.title, { timeout: 10_000 });
  await expect(tv.locator('.tv-offline-receiver__artist')).toHaveText(first.displayArtist);
  await expect(tv.locator('.tv-offline-receiver__album')).toHaveText(first.album);
  await expect.poll(async () => tv.locator('audio').evaluateAll(elements => (
    elements.some(element => (element as HTMLAudioElement).src.startsWith('blob:'))
  ))).toBe(true);

  await expect.poll(() => fixture.diagnostics().requests.length).toBe(lanRequestCountAtConnection);
  expect(backendRequests).toBe(backendRequestsAtConnection);

  await tvContext.close();
});
