import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('playback normal permanece funcional sem metadata rítmica em mobile e desktop', async ({ page }, testInfo) => {
  test.skip(!['mobile-chromium', 'desktop-chromium'].includes(testInfo.project.name));

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

  await login(page);

  const isMobile = testInfo.project.name === 'mobile-chromium';
  const player = isMobile
    ? page.locator('.player-screen-immersive')
    : page.locator('.desktop-now-playing-screen');

  await expect(player).toBeVisible();
  await expect(player.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const playButton = isMobile
    ? page.locator('.player-hero-play__control')
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
    input.value = '50';
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
