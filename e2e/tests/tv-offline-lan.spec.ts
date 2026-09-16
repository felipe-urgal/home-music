import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
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
    }
    localStorage.setItem(`home-music:offline-tracks:v2:${encodeURIComponent(userId)}`, JSON.stringify(records));
    return tracks.map(track => ({ id: String(track.id), title: String(track.title) }));
  }, titles);
}

function lanFixture() {
  const version = 'home-music-lan-remote-v1';
  const sessionId = 'session_1234567890abcdef';
  const secret = '00112233445566778899aabbccddeeff';
  const sessionToken = 'token_1234567890abcdef';
  const expiresAt = Date.now() + 90_000;
  const messages: Array<{ cursor: number; from: 'remote' | 'tv'; body: unknown }> = [];
  let cursor = 0;
  const qrText = `home-music://tv-lan?version=${version}&host=192.168.1.40&port=43123&session=${sessionId}&secret=${secret}&expires=${expiresAt}`;

  const route = async (requestRoute: Route) => {
    const request = requestRoute.request();
    const url = new URL(request.url());
    const origin = request.headers().origin || 'http://127.0.0.1:8791';
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
  return { qrText, route };
}

async function serveReceiver(context: BrowserContext, fixtureRoute: (route: Route) => Promise<void>) {
  await context.route('http://127.0.0.1:43123/**', fixtureRoute);
  await context.route('http://192.168.1.40:43123/**', fixtureRoute);
  await context.route('http://tv-offline.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/receiver/bootstrap') return fixtureRoute(route);
    const relative = url.pathname === '/receiver/' ? 'tv-offline-receiver.html' : url.pathname.replace(/^\/receiver\//, '');
    const file = path.resolve(receiverRoot, relative);
    if (!file.startsWith(receiverRoot)) return route.fulfill({ status: 404 });
    const body = await readFile(file);
    const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
    return route.fulfill({ status: 200, contentType, body });
  });
}

test('PWA envia duas faixas e comandos para o receiver LAN sem backend', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/');
  const tracks = await seedOfflineTracks(page, ['E2E Zeta', 'E2E Zulu']);
  const fixture = lanFixture();
  const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvContext.newPage();
  await serveReceiver(tvContext, fixture.route);
  await tv.goto('http://tv-offline.test/receiver/');
  await expect(tv.locator('.tv-offline-receiver')).toBeVisible({ timeout: 10_000 });
  await expect(tv.locator('.tv-offline-receiver__status')).toContainText(/Receiver offline pronto|Aguardando o celular/);

  let backendRequests = 0;
  await page.context().route('http://192.168.1.40:43123/**', fixture.route);
  await page.context().route('**/api/**', route => { backendRequests += 1; return route.abort('connectionrefused'); });
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Conectar à TV', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept(fixture.qrText));
  await page.getByRole('button', { name: 'Conectar à TV', exact: true }).click();
  await expect(page.getByText(/TV conectada em/)).toBeVisible({ timeout: 10_000 });
  const requestsAtConnection = backendRequests;

  for (const track of tracks) {
    await page.getByRole('button', { name: new RegExp(track.title) }).click();
    await expect(tv.locator('.tv-offline-receiver__now-playing strong')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => tv.locator('audio').evaluateAll(elements => (
      elements.some(element => (element as HTMLAudioElement).src.startsWith('blob:'))
    ))).toBe(true);
  }

  expect(backendRequests).toBe(requestsAtConnection);
  expect(await page.locator('audio').evaluateAll(elements => elements.every(element => (element as HTMLAudioElement).paused))).toBe(true);
  await tvContext.close();
});
