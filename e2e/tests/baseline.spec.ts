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
  const heroArt = page.locator('.hero-art');
  const sidebar = page.getByTestId('desktop-sidebar');
  const context = page.getByTestId('desktop-context');
  const desktopQueue = page.getByTestId('desktop-queue');
  const desktopPlayerBar = page.getByTestId('desktop-player-bar');
  const embeddedPlayerQueue = page.locator('.queue-panel--player');
  const isDesktop = Boolean(viewport && viewport.width >= 1024);
  const isTablet = Boolean(viewport && viewport.width >= 700 && viewport.width < 1024);

  if (isDesktop && viewport) {
    await expect(sidebar).toBeVisible();
    await expect(context).toBeVisible();
    await expect(desktopQueue).toBeVisible();
    await expect(desktopPlayerBar).toBeVisible();
    await expect(embeddedPlayerQueue).toBeHidden();
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(context).toContainText('E2E Track');
    await expect(desktopQueue).toContainText('E2E Track');
    await expect(desktopPlayerBar).toContainText('E2E Track');
    await expect(desktopPlayerBar.getByRole('button', { name: 'Tocar na barra desktop' })).toBeVisible();

    expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('grid');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(surfaceBox!.width).toBeGreaterThan(480);

    const barBox = await desktopPlayerBar.boundingBox();
    expect(barBox).not.toBeNull();
    expect(Math.abs(barBox!.y + barBox!.height - viewport.height)).toBeLessThanOrEqual(2);

    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(documentHeight).toBeLessThanOrEqual(viewport.height + 2);
  } else if (viewport) {
    await expect(sidebar).toBeHidden();
    await expect(context).toBeHidden();
    await expect(desktopPlayerBar).toBeHidden();
    await expect(embeddedPlayerQueue).toBeVisible();

    expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('block');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(surfaceBox!.x).toBeGreaterThanOrEqual(-1);
    expect(surfaceBox!.x + surfaceBox!.width).toBeLessThanOrEqual(viewport.width + 1);

    if (isTablet) {
      expect(surfaceBox!.width).toBeGreaterThan(700);
      expect(surfaceBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await surface.evaluate(element => getComputedStyle(element).borderRadius)).toBe('0px');
      const artBox = await heroArt.boundingBox();
      expect(artBox).not.toBeNull();
      expect(artBox!.width).toBeLessThanOrEqual(442);
    } else {
      expect(surfaceBox!.width).toBeLessThanOrEqual(Math.min(480, viewport.width) + 1);
    }
  }

  const playButton = page.getByRole('button', { name: 'Tocar', exact: true });
  await expect(playButton).toBeVisible();
  await playButton.click();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();

  if (isDesktop) {
    await expect(desktopPlayerBar.getByRole('button', { name: 'Pausar na barra desktop' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await expect(page.locator('.library-header__title strong')).toHaveText('Biblioteca');
  await expect(page.locator('.library-header__title small')).toContainText('1 música');

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Biblioteca' })).toHaveAttribute('aria-current', 'page');
    await expect(desktopPlayerBar).toBeVisible();
    await expect(desktopPlayerBar).toContainText('E2E Track');

    const persistentProgress = desktopPlayerBar.getByLabel('Progresso da reprodução na barra desktop');
    await expect(persistentProgress).toBeEnabled();
    const progressBefore = Number(await persistentProgress.inputValue());
    await expect.poll(async () => Number(await persistentProgress.inputValue()), { timeout: 3_000 })
      .toBeGreaterThan(progressBefore + 0.2);

    await desktopPlayerBar.getByRole('button', { name: 'Pausar na barra desktop' }).click();
    await expect(desktopPlayerBar.getByRole('button', { name: 'Tocar na barra desktop' })).toBeVisible();
    await desktopPlayerBar.getByRole('button', { name: 'Tocar na barra desktop' }).click();
    await expect(desktopPlayerBar.getByRole('button', { name: 'Pausar na barra desktop' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Músicas', exact: true }).click();
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toBeVisible();

  if (isDesktop) {
    const desktopLibraryTable = page.getByTestId('desktop-library-table');
    await expect(desktopLibraryTable).toBeVisible();
    await expect(desktopLibraryTable.getByRole('button', { name: 'Tocar E2E Track' })).toBeVisible();
    await expect(page.locator('.library-track')).toHaveCount(0);

    const titleHeader = desktopLibraryTable.getByRole('columnheader', { name: /ordenar por título/i });
    await expect(titleHeader).toHaveAttribute('aria-sort', 'none');
    await desktopLibraryTable.getByRole('button', { name: 'Ordenar por título' }).click();
    await expect(titleHeader).toHaveAttribute('aria-sort', 'ascending');
    await desktopLibraryTable.getByRole('button', { name: 'Ordenar por título' }).click();
    await expect(titleHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(desktopLibraryTable.getByRole('columnheader', { name: /ordenar por artista/i })).toBeVisible();
    await expect(desktopLibraryTable.getByRole('columnheader', { name: /ordenar por álbum/i })).toBeVisible();
    await expect(desktopLibraryTable.getByRole('columnheader', { name: 'Pasta' })).toBeVisible();
    await expect(desktopLibraryTable.getByRole('columnheader', { name: 'Formato' })).toBeVisible();
    await expect(desktopLibraryTable.getByRole('columnheader', { name: 'Duração' })).toBeVisible();
  } else {
    await expect(page.locator('.library-track').filter({ hasText: 'E2E Track' })).toBeVisible();
    await expect(page.getByTestId('desktop-library-table')).toHaveCount(0);
  }

  if (viewport) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  }

  if (isDesktop) {
    await desktopPlayerBar.getByRole('button', { name: 'Abrir E2E Track no player' }).click();
  } else {
    await page.getByRole('button', { name: 'Voltar ao player' }).click();
  }

  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(desktopQueue).toBeVisible();
    await expect(desktopPlayerBar).toBeVisible();
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
  const desktopPlayerBar = page.getByTestId('desktop-player-bar');
  const embeddedPlayerQueue = page.locator('.queue-panel--player');

  await expect(sidebar).toBeHidden();
  await expect(context).toBeHidden();
  await expect(desktopPlayerBar).toBeHidden();
  await expect(embeddedPlayerQueue).toBeVisible();
  expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('block');

  const tabletBox = await surface.boundingBox();
  expect(tabletBox).not.toBeNull();
  expect(tabletBox!.width).toBeGreaterThan(700);
  expect(tabletBox!.width).toBeLessThanOrEqual(1024);

  await page.setViewportSize({ width: 1024, height: 900 });

  await expect(sidebar).toBeVisible();
  await expect(context).toBeVisible();
  await expect(desktopPlayerBar).toBeVisible();
  await expect(embeddedPlayerQueue).toBeHidden();
  expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('grid');

  const desktopBox = await surface.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeGreaterThan(480);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1025);
});
