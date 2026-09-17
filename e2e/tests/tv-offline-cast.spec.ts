import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function seedOfflineTrack(page: Page, title: string) {
  return page.evaluate(async requestedTitle => {
    const libraryResponse = await fetch('/api/library', { credentials: 'same-origin' });
    if (!libraryResponse.ok) throw new Error(`library ${libraryResponse.status}`);
    const library = await libraryResponse.json() as { tracks?: Array<Record<string, unknown>> };
    const track = library.tracks?.find(candidate => candidate.title === requestedTitle);
    if (!track || typeof track.id !== 'string') throw new Error(`track ${requestedTitle} not found`);

    const userId = localStorage.getItem('home-music:offline-user-id:v1');
    if (!userId) throw new Error('offline user missing');
    const streamPath = `/api/tracks/${encodeURIComponent(track.id)}/stream`;
    const streamResponse = await fetch(streamPath, { credentials: 'same-origin' });
    if (!streamResponse.ok) throw new Error(`stream ${streamResponse.status}`);
    const responseForCache = streamResponse.clone();
    const blob = await streamResponse.blob();
    const mimeType = (streamResponse.headers.get('Content-Type') || blob.type || 'audio/wav').split(';')[0];
    const cacheName = `home-music-offline-audio-v2-${encodeURIComponent(userId)}`;
    const manifestKey = `home-music:offline-tracks:v2:${encodeURIComponent(userId)}`;
    const cache = await caches.open(cacheName);
    await cache.put(streamPath, responseForCache);
    localStorage.setItem(manifestKey, JSON.stringify([{
      track,
      size: blob.size,
      mimeType,
      downloadedAt: new Date().toISOString()
    }]));
    return { id: track.id, title: String(track.title) };
  }, title);
}

test('celular envia faixa baixada por WebRTC e a TV toca a fonte P2P', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/?tv=1');
  await expect(page.locator('.tv-app--now-playing')).toBeVisible();

  const remoteEntry = page.getByRole('button', { name: 'Controlar pelo celular', exact: true });
  await remoteEntry.click();
  const pairingLink = page.getByRole('link', { name: 'Abrir controle no celular' });
  await expect(pairingLink).toBeVisible();
  const pairingUrl = await pairingLink.getAttribute('href');
  expect(pairingUrl).toBeTruthy();

  const origin = new URL(page.url()).origin;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  try {
    await login(phone, `${origin}/`);
    await expect(phone.locator('.app-shell')).toBeVisible();
    const target = await seedOfflineTrack(phone, 'E2E Zulu');
    await phone.addInitScript(() => {
      const originalCreateDataChannel = RTCPeerConnection.prototype.createDataChannel;
      Object.defineProperty(RTCPeerConnection.prototype, 'createDataChannel', {
        configurable: true,
        value: function (this: RTCPeerConnection, label: string, options?: RTCDataChannelInit) {
          const channel = originalCreateDataChannel.call(this, label, options);
          if (label === 'home-music-media-v1') {
            const setReady = (ready: boolean) => {
              (window as typeof window & { __homeMusicTvMediaReady?: boolean }).__homeMusicTvMediaReady = ready;
            };
            channel.addEventListener('open', () => setReady(true));
            channel.addEventListener('close', () => setReady(false));
            setReady(channel.readyState === 'open');
          }
          return channel;
        }
      });
    });
    await phone.goto(pairingUrl!);

    await expect(phone.locator('.tv-remote-screen')).toBeVisible();
    await expect(phone.locator('audio')).toHaveCount(0);
    await expect(phone.getByText('TV conectada', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect.poll(
      () => phone.evaluate(() => (
        (window as typeof window & { __homeMusicTvMediaReady?: boolean }).__homeMusicTvMediaReady === true
      )),
      { timeout: 10_000 }
    ).toBe(true);
    await expect(phone.getByText('Áudio direto pronto para seus downloads.', { exact: true })).toHaveCount(0);

    await phone.getByRole('button', { name: /Biblioteca/ }).click();
    await phone.getByRole('button', { name: /^Pastas/ }).click();
    const targetButton = phone.getByRole('button', { name: new RegExp(target.title) });
    await expect(targetButton).toBeVisible();
    await targetButton.click();

    await expect(phone.getByText('Música enviada diretamente do celular.', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.tv-now-playing__title')).toHaveText(target.title, { timeout: 10_000 });
    await expect.poll(async () => page.locator('audio').evaluateAll(elements => (
      elements.some(element => (element as HTMLAudioElement).src.startsWith('blob:'))
    )), { timeout: 5_000 }).toBe(true);
    await expect(phone.locator('audio')).toHaveCount(0);
  } finally {
    await phoneContext.close();
  }
});
