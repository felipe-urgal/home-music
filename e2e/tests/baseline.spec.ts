import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

test('login, biblioteca e player permanecem utilizáveis', async ({ page }) => {
  await login(page);

  const viewport = page.viewportSize();
  const responsiveShell = page.locator('.desktop-layout');
  const surface = page.locator('.phone-surface');
  const sidebar = page.getByTestId('desktop-sidebar');
  const context = page.getByTestId('desktop-context');
  const desktopQueue = page.getByTestId('desktop-queue');
  const embeddedPlayerQueue = page.locator('.queue-panel--player');
  const isDesktop = Boolean(viewport && viewport.width >= 1024);

  if (isDesktop && viewport) {
    await expect(sidebar).toBeVisible();
    await expect(context).toBeVisible();
    await expect(desktopQueue).toBeVisible();
    await expect(embeddedPlayerQueue).toBeHidden();
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(context).toContainText('E2E Track');
    await expect(desktopQueue).toContainText('E2E Track');

    expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('grid');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(surfaceBox!.width).toBeGreaterThan(480);

    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(documentHeight).toBeLessThanOrEqual(viewport.height + 2);
  } else if (viewport) {
    await expect(sidebar).toBeHidden();
    await expect(context).toBeHidden();
    await expect(embeddedPlayerQueue).toBeVisible();

    expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('block');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(surfaceBox!.width).toBeLessThanOrEqual(Math.min(480, viewport.width) + 1);
    expect(surfaceBox!.x).toBeGreaterThanOrEqual(-1);
    expect(surfaceBox!.x + surfaceBox!.width).toBeLessThanOrEqual(viewport.width + 1);
  }

  const playButton = page.getByRole('button', { name: 'Tocar' });
  await expect(playButton).toBeVisible();
  await playButton.click();
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible();

  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await expect(page.locator('.library-header__title strong')).toHaveText('Biblioteca');
  await expect(page.locator('.library-header__title small')).toContainText('1 música');

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Biblioteca' })).toHaveAttribute('aria-current', 'page');
  }

  await page.getByRole('button', { name: 'Músicas', exact: true }).click();
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toBeVisible();
  await expect(page.locator('.library-track').filter({ hasText: 'E2E Track' })).toBeVisible();

  if (viewport) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  }

  await page.getByRole('button', { name: 'Voltar ao player' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(desktopQueue).toBeVisible();
    await expect(embeddedPlayerQueue).toBeHidden();
  }
});

test('desktop só ativa a partir de 1024px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await page.setViewportSize({ width: 1023, height: 900 });
  await login(page);

  const responsiveShell = page.locator('.desktop-layout');
  const surface = page.locator('.phone-surface');
  const sidebar = page.getByTestId('desktop-sidebar');
  const context = page.getByTestId('desktop-context');
  const embeddedPlayerQueue = page.locator('.queue-panel--player');

  await expect(sidebar).toBeHidden();
  await expect(context).toBeHidden();
  await expect(embeddedPlayerQueue).toBeVisible();
  expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('block');

  const mobileBox = await surface.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.width).toBeLessThanOrEqual(481);

  await page.setViewportSize({ width: 1024, height: 900 });

  await expect(sidebar).toBeVisible();
  await expect(context).toBeVisible();
  await expect(embeddedPlayerQueue).toBeHidden();
  expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('grid');

  const desktopBox = await surface.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeGreaterThan(480);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1025);
});