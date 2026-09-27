import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function prepareSession(page: Page) {
  const loginResponse = await page.context().request.post('/api/auth/login', {
    headers: { 'X-Home-Music-Request': '1' },
    data: { username, password }
  });
  expect(loginResponse.ok()).toBe(true);

  const libraryResponse = await page.context().request.get('/api/library');
  expect(libraryResponse.ok()).toBe(true);
  const library = await libraryResponse.json() as {
    tracks: Array<{ id: string; title: string }>;
  };

  const current = library.tracks.find(track => track.title === 'E2E Track');
  expect(current).toBeTruthy();
  const queueIds = library.tracks.map(track => track.id);

  const resetResponse = await page.context().request.put('/api/player/state', {
    headers: { 'X-Home-Music-Request': '1' },
    data: {
      currentTrackId: current!.id,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueueIds: queueIds,
      queueIds
    }
  });
  expect(resetResponse.ok()).toBe(true);
}

test('playback normal permanece funcional sem metadata rítmica em mobile e desktop', async ({ page }, testInfo) => {
  test.skip(!['mobile-chromium', 'desktop-chromium'].includes(testInfo.project.name));

  await prepareSession(page);

  await page.route('**/api/library', async route => {
    const response = await route.fetch();
    const body = await response.json() as {
      tracks: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };

    await route.fulfill({
      response,
      json: {
        ...body,
        tracks: body.tracks.map(track => {
          const { rhythm: _rhythm, ...withoutRhythm } = track;
          return withoutRhythm;
        })
      }
    });
  });

  await page.goto('/');

  const isMobile = testInfo.project.name === 'mobile-chromium';
  const player = isMobile
    ? page.locator('.player-screen-immersive')
    : page.locator('.desktop-now-playing-screen');

  await expect(player).toBeVisible();
  await expect(page.getByText('E2E Track', { exact: true }).first()).toBeVisible();

  const playButton = isMobile
    ? page.locator('.controls .play-button')
    : page.locator('.desktop-now-playing-screen__cover-play');

  await expect(playButton).toHaveAttribute('aria-label', 'Tocar');
  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Pausar');

  await expect.poll(async () => page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .some(audio => !audio.paused && !audio.ended && audio.currentTime > 0.15)
  )), { timeout: 8_000, intervals: [100, 200, 400] }).toBe(true);

  const playingBeforeSeek = await page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => !audio.paused && !audio.ended)?.currentTime ?? 0
  ));
  expect(playingBeforeSeek).toBeGreaterThan(0);

  const seekTarget = isMobile
    ? page.locator('input[type="range"][aria-label="Progresso da música"]')
    : page.locator('.desktop-now-playing-screen__waveform-seek');

  await seekTarget.evaluate((element) => {
    const input = element as HTMLInputElement;
    const max = Number(input.max);
    input.value = String(Number.isFinite(max) && max > 0 ? max / 2 : 5);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect.poll(async () => page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => !audio.paused && !audio.ended)?.currentTime ?? 0
  )), { timeout: 5_000 }).toBeGreaterThan(3);

  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Tocar');

  const pausedAt = await page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => audio.currentTime > 0)?.currentTime ?? 0
  ));

  await page.waitForTimeout(350);

  const stillPausedAt = await page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => audio.currentTime > 0)?.currentTime ?? 0
  ));
  expect(Math.abs(stillPausedAt - pausedAt)).toBeLessThan(0.2);

  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Pausar');

  await expect.poll(async () => page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => !audio.paused && !audio.ended)?.currentTime ?? 0
  )), { timeout: 5_000 }).toBeGreaterThan(stillPausedAt + 0.2);
});
