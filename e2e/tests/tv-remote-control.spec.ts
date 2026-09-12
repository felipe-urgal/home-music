import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const crossfadeStorageKey = 'home-music:crossfade-seconds:v2';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

type LibraryPayload = {
  tracks: Array<{ id: string; title: string }>;
};

async function login(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('TV mostra o now playing aprovado e celular autenticado controla a reprodução', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  const loginResponse = await page.context().request.post('/api/auth/login', {
    headers: mutationHeaders,
    data: { username, password }
  });
  expect(loginResponse.ok()).toBeTruthy();
  const libraryResponse = await page.context().request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as LibraryPayload;
  const trackIds = new Map(library.tracks.map(track => [track.title, track.id]));
  const queueIds = ['E2E Track', 'E2E Zeta', 'E2E Zulu'].map(title => {
    const id = trackIds.get(title);
    expect(id).toBeTruthy();
    return id!;
  });
  const resetResponse = await page.context().request.put('/api/player/state', {
    headers: mutationHeaders,
    data: {
      currentTrackId: queueIds[0],
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueueIds: queueIds,
      queueIds
    }
  });
  expect(resetResponse.ok()).toBeTruthy();

  await page.addInitScript(({ storageKey }) => {
    window.localStorage.setItem(storageKey, '2');
  }, { storageKey: crossfadeStorageKey });

  await page.goto('/?tv=1');
  await expect(page.locator('.tv-app--now-playing')).toBeVisible();
  await expect(page.locator('.tv-now-playing__title')).toHaveText(/E2E/);
  await expect(page.getByText('Home Music', { exact: true })).toBeVisible();
  await expect(page.getByText('TOCANDO AGORA', { exact: true })).toBeVisible();
  await expect(page.getByText(/Good music/)).toBeVisible();

  const pairingLink = page.getByRole('link', { name: 'Abrir controle no celular' });
  await expect(pairingLink).toBeVisible();
  await expect(pairingLink.locator('img')).toHaveAttribute('alt', 'QR code para controlar a TV pelo celular');
  const pairingUrl = await pairingLink.getAttribute('href');
  expect(pairingUrl).toBeTruthy();
  const sessionId = new URL(pairingUrl!).pathname.split('/').filter(Boolean).at(-1);
  expect(sessionId).toBeTruthy();

  await expect(page.getByRole('button', { name: 'Aleatório', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Faixa anterior', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Próxima faixa', exact: true })).toBeEnabled();

  const origin = new URL(page.url()).origin;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  try {
    await login(phone, `${origin}/`);
    await expect(phone.locator('.app-shell')).toBeVisible();
    await phone.goto(pairingUrl!);

    await expect(phone.locator('.tv-remote-screen')).toBeVisible();
    await expect(phone.locator('audio')).toHaveCount(0);
    await expect(phone.getByText('Home Music TV', { exact: true })).toBeVisible();

    const tvPlay = page.locator('.tv-now-playing__play');
    const phonePlay = phone.locator('.tv-remote-controls__primary');
    await expect(phonePlay).toBeEnabled();

    const initialAction = await tvPlay.getAttribute('aria-label');
    expect(['Tocar', 'Pausar']).toContain(initialAction);
    await expect(phonePlay).toHaveAttribute('aria-label', initialAction!);

    const toggledAction = initialAction === 'Tocar' ? 'Pausar' : 'Tocar';
    await tvPlay.click();
    await expect(tvPlay).toHaveAttribute('aria-label', toggledAction);
    await expect(phonePlay).toHaveAttribute('aria-label', toggledAction, { timeout: 5_000 });

    await phonePlay.click();
    await expect(tvPlay).toHaveAttribute('aria-label', initialAction!, { timeout: 5_000 });

    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
    if (await tvPlay.getAttribute('aria-label') === 'Tocar') {
      await tvPlay.click();
      await expect(tvPlay).toHaveAttribute('aria-label', 'Pausar');
    }
    await expect.poll(async () => page.evaluate(() => Array.from(document.querySelectorAll('audio'))
      .some(audio => !audio.paused && !audio.ended && audio.currentTime > 0)), { timeout: 5_000 }).toBe(true);

    const title = page.locator('.tv-now-playing__title');
    const beforeTitle = await title.textContent();
    const nextResponse = await phone.context().request.post(`/api/tv-remote/sessions/${sessionId}/commands`, {
      headers: mutationHeaders,
      data: { type: 'next' }
    });
    expect(nextResponse.ok()).toBeTruthy();

    await expect.poll(async () => page.evaluate(() => {
      const playingDecks = Array.from(document.querySelectorAll('audio'))
        .filter(audio => !audio.paused && !audio.ended && audio.currentTime > 0);
      return playingDecks.length === 2
        && playingDecks.every(audio => audio.volume > 0 && audio.volume < 1);
    }), { timeout: 5_000, intervals: [100, 200] }).toBe(true);

    await expect(page.locator('.tv-now-playing__identity-stack[data-crossfading="true"]')).toBeVisible();
    await expect.poll(async () => title.textContent(), { timeout: 5_000 }).not.toBe(beforeTitle);

    const progress = page.locator('.tv-now-playing__progress');
    const beforeSeek = await progress.getAttribute('aria-label');
    await phone.getByRole('button', { name: 'Avançar 10 segundos', exact: true }).click();
    await expect.poll(async () => progress.getAttribute('aria-label'), { timeout: 5_000 }).not.toBe(beforeSeek);
  } finally {
    await phoneContext.close();
  }
});
