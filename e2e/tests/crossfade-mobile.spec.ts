import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const crossfadeStorageKey = 'home-music:crossfade-seconds:v2';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

test('crossfade mistura dois decks reais no Chromium mobile e faz handoff sem reiniciar a próxima faixa', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await page.addInitScript(({ storageKey }) => {
    window.localStorage.setItem(storageKey, '2');
  }, { storageKey: crossfadeStorageKey });

  await login(page);
  await expect(page.locator('audio')).toHaveCount(2);

  await page.getByRole('button', { name: 'Tocar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();

  await expect.poll(async () => page.evaluate(() => {
    const playingDecks = Array.from(document.querySelectorAll('audio'))
      .filter(audio => !audio.paused && !audio.ended && audio.currentTime > 0);

    return playingDecks.length === 2
      && playingDecks.every(audio => audio.volume > 0 && audio.volume < 1);
  }), { timeout: 12_000, intervals: [200, 400] }).toBe(true);

  const incomingPositionDuringMix = await page.evaluate(() => {
    const audios = Array.from(document.querySelectorAll('audio'));
    return Math.min(...audios
      .filter(audio => !audio.paused && audio.currentTime > 0)
      .map(audio => audio.currentTime));
  });
  expect(incomingPositionDuringMix).toBeGreaterThan(0);

  await expect(page.getByRole('heading', { name: 'E2E Zeta' })).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .filter(audio => !audio.paused && !audio.ended && audio.currentTime > 0)
      .length
  )), { timeout: 2_000 }).toBe(1);

  const adoptedPosition = await page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => !audio.paused && !audio.ended)?.currentTime ?? 0
  ));
  expect(adoptedPosition).toBeGreaterThan(0.25);
});
