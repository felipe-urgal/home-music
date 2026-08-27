import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
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
  const miniPlayer = page.getByTestId('mini-player');
  const mobileNavigation = page.getByRole('navigation', { name: 'Navegação principal' });
  const isDesktop = Boolean(viewport && viewport.width >= 1024);
  const isTablet = Boolean(viewport && viewport.width >= 700 && viewport.width < 1024);
  const isMobile = Boolean(viewport && viewport.width < 700);

  if (isDesktop && viewport) {
    await expect(sidebar).toBeVisible();
    await expect(context).toBeVisible();
    await expect(desktopQueue).toBeVisible();
    await expect(desktopPlayerBar).toBeHidden();
    await expect(embeddedPlayerQueue).toBeHidden();
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(context).toContainText('E2E Track');
    await expect(desktopQueue).not.toContainText('E2E Track');
    await expect(desktopQueue).toContainText('E2E Zeta');
    await expect(page.getByRole('button', { name: 'Mais opções' })).toHaveCount(0);

    for (const label of ['Pastas', 'Playlists']) {
      await expect(sidebar.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['Músicas', 'Artistas', 'Álbuns', 'Favoritos', 'Rekordbox', 'Histórico', 'Estatísticas']) {
      await expect(sidebar.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await expect(sidebar.getByRole('button', { name: 'Atualizar biblioteca', exact: true })).toBeVisible();

    const accountButton = sidebar.getByRole('button', { name: /Minha conta/ });
    await expect(accountButton).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Reprodução', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Sair da conta', exact: true })).toHaveCount(0);
    await accountButton.click();
    await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
    const reproduction = page.getByRole('button', { name: /Reprodução/ });
    await expect(reproduction).toBeVisible();
    await reproduction.click();
    await expect(page.getByLabel('Preferências de reprodução')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Tocando agora' }).click();
    await expect(desktopQueue).toBeVisible();

    const zuluHandle = desktopQueue.getByRole('button', { name: 'Arrastar E2E Zulu' });
    const zetaRow = desktopQueue.locator('.desktop-queue__row').filter({ hasText: 'E2E Zeta' });
    await expect(zuluHandle).toBeVisible();
    await expect(zetaRow).toBeVisible();
    await zuluHandle.dragTo(zetaRow);
    await expect(desktopQueue.locator('.desktop-queue__row').nth(0)).toContainText('E2E Zulu');

    const contextTabs = context.getByRole('tablist', { name: 'Painel contextual' });
    const queueTab = contextTabs.getByRole('tab', { name: 'Fila' });
    const lyricsTab = contextTabs.getByRole('tab', { name: 'Letra' });
    await expect(queueTab).toHaveAttribute('aria-selected', 'true');
    await expect(lyricsTab).toBeVisible();
    await lyricsTab.click();
    await expect(page.getByTestId('desktop-lyrics')).toBeVisible();
    await expect(page.getByTestId('desktop-lyrics')).toContainText('Linha E2E um');
    await expect(page.getByTestId('desktop-queue')).toHaveCount(0);
    await queueTab.click();
    await expect(desktopQueue).toBeVisible();

    expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('grid');
    const surfaceBox = await surface.boundingBox();
    expect(surfaceBox).not.toBeNull();
    expect(surfaceBox!.width).toBeGreaterThan(480);

    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(documentHeight).toBeLessThanOrEqual(viewport.height + 2);
  } else if (viewport) {
    await expect(sidebar).toBeHidden();
    await expect(context).toBeHidden();
    await expect(desktopPlayerBar).toHaveCount(0);
    await expect(embeddedPlayerQueue).toBeVisible();
    await expect(page.getByRole('button', { name: 'Letra' })).toBeVisible();

    if (isTablet) {
      await expect(page.getByRole('button', { name: 'Arrastar E2E Zeta' })).toBeVisible();
      await expect(mobileNavigation).toBeHidden();
    } else {
      await expect(mobileNavigation).toBeVisible();
      await expect(mobileNavigation.getByRole('button', { name: 'Agora', exact: true })).toHaveAttribute('aria-current', 'page');
      const queueToggle = page.getByRole('button', { name: /A seguir/ });
      await expect(queueToggle).toBeVisible();
      await expect(page.getByRole('button', { name: 'Arrastar E2E Zeta' })).toBeHidden();
      await queueToggle.click();
      await expect(page.getByRole('button', { name: 'Arrastar E2E Zeta' })).toBeVisible();
      await queueToggle.click();
    }

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
  const pauseButton = page.getByRole('button', { name: 'Pausar', exact: true });
  if (await playButton.isVisible()) {
    await playButton.click();
  }
  await expect(pauseButton).toBeVisible();

  if (isDesktop) {
    await expect(desktopPlayerBar).toBeHidden();
    await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();
  } else if (isTablet) {
    await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  } else {
    await mobileNavigation.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  }

  if (isDesktop) {
    await expect(page.locator('.library-header__title strong')).toBeHidden();
  } else {
    await expect(page.locator('.library-header__title strong')).toHaveText('Biblioteca');
    if (isTablet) {
      await expect(page.locator('.library-header__title small')).toContainText('3 músicas');
    } else {
      await expect(page.locator('.library-header__title small')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Atualizar biblioteca' })).toBeVisible();
    }
  }
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ordenar e filtrar biblioteca' })).toHaveCount(0);

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Pastas', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(desktopPlayerBar).toBeVisible();
    await expect(desktopPlayerBar).toContainText('E2E Track');
    await expect(miniPlayer).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir estatísticas' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Voltar ao player' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navegação da biblioteca' })).toBeHidden();
    await expect(sidebar.getByRole('button', { name: 'Atualizar biblioteca', exact: true })).toBeVisible();

    const persistentProgress = desktopPlayerBar.getByLabel('Progresso da reprodução na barra desktop');
    await expect(persistentProgress).toBeEnabled();
    const progressBefore = Number(await persistentProgress.inputValue());
    await expect.poll(async () => Number(await persistentProgress.inputValue()), { timeout: 3_000 })
      .toBeGreaterThan(progressBefore + 0.2);

    await desktopPlayerBar.getByRole('button', { name: 'Pausar na barra desktop' }).click();
    await expect(desktopPlayerBar.getByRole('button', { name: 'Tocar na barra desktop' })).toBeVisible();
    await desktopPlayerBar.getByRole('button', { name: 'Tocar na barra desktop' }).click();
    await expect(desktopPlayerBar.getByRole('button', { name: 'Pausar na barra desktop' })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: 'Navegação da biblioteca' })).toBeVisible();
    await expect(miniPlayer).toBeVisible();
    await expect(desktopPlayerBar).toHaveCount(0);
    for (const label of ['Pastas', 'Playlists']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['Músicas', 'Artistas', 'Álbuns', 'Favoritos', 'Histórico']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    if (isMobile) {
      await expect(mobileNavigation.getByRole('button', { name: 'Biblioteca', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: 'Voltar ao player' })).toBeHidden();
    }
  }

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

    await desktopLibraryTable.getByRole('checkbox', { name: 'Selecionar E2E Track' }).check();
    await desktopLibraryTable.getByRole('checkbox', { name: 'Selecionar E2E Zeta' }).check();
    const bulkToolbar = page.getByTestId('desktop-bulk-toolbar');
    await expect(bulkToolbar).toContainText('2 selecionadas');
    await expect(bulkToolbar.getByRole('button', { name: 'Tocar seleção', exact: true })).toBeVisible();
    await expect(bulkToolbar.getByRole('button', { name: 'Favoritar', exact: true })).toHaveCount(0);
    await expect(bulkToolbar.getByRole('button', { name: 'Desfavoritar', exact: true })).toHaveCount(0);
    await bulkToolbar.getByRole('button', { name: 'Limpar seleção', exact: true }).click();
    await expect(bulkToolbar).toContainText('Selecionar faixas');
  } else {
    await expect(page.getByTestId('desktop-library-table')).toHaveCount(0);
    await expect(page.getByTestId('desktop-bulk-toolbar')).toHaveCount(0);
  }

  if (isDesktop) {
    await sidebar.getByRole('button', { name: 'Playlists', exact: true }).click();
    const libraryMain = page.locator('.desktop-main-content--library');
    await expect(libraryMain.locator('.section-heading > span').filter({ hasText: /^Playlists$/ })).toBeVisible();
    await expect(libraryMain.getByRole('button', { name: 'Rekordbox', exact: true })).toHaveCount(0);
  }

  if (viewport) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  }

  if (isDesktop) {
    await desktopPlayerBar.getByRole('button', { name: 'Abrir E2E Track no player' }).click();
  } else if (isTablet) {
    await page.getByRole('button', { name: 'Voltar ao player' }).click();
  } else {
    await mobileNavigation.getByRole('button', { name: 'Agora', exact: true }).click();
  }

  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(desktopQueue).toBeVisible();
    await expect(desktopPlayerBar).toBeHidden();
    await expect(embeddedPlayerQueue).toBeHidden();
  } else if (isMobile) {
    await expect(mobileNavigation.getByRole('button', { name: 'Agora', exact: true })).toHaveAttribute('aria-current', 'page');
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
  await expect(desktopPlayerBar).toHaveCount(0);
  await expect(embeddedPlayerQueue).toBeVisible();
  expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('block');

  const tabletBox = await surface.boundingBox();
  expect(tabletBox).not.toBeNull();
  expect(tabletBox!.width).toBeGreaterThan(700);
  expect(tabletBox!.width).toBeLessThanOrEqual(1024);

  await page.setViewportSize({ width: 1024, height: 900 });

  await expect(sidebar).toBeVisible();
  await expect(context).toBeVisible();
  await expect(desktopPlayerBar).toBeHidden();
  await expect(embeddedPlayerQueue).toBeHidden();
  expect(await responsiveShell.evaluate(element => getComputedStyle(element).display)).toBe('grid');

  const desktopBox = await surface.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeGreaterThan(480);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(1025);
});

test('atalhos de teclado desktop controlam reprodução', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const playButton = page.getByRole('button', { name: 'Tocar', exact: true });
  const pauseButton = page.getByRole('button', { name: 'Pausar', exact: true });
  if (await pauseButton.isVisible()) {
    await page.keyboard.press('Space');
    await expect(playButton).toBeVisible();
  }

  await page.keyboard.press('Space');
  await expect(pauseButton).toBeVisible();
  await page.keyboard.press('Space');
  await expect(playButton).toBeVisible();

  const progress = page.getByLabel('Progresso da música');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => Number(await progress.inputValue())).toBeLessThan(0.5);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThanOrEqual(4.5);

  const volume = page.getByRole('slider', { name: 'Volume', exact: true });
  const initialVolume = Number(await volume.inputValue());
  if (initialVolume >= 0.05) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => Number(await volume.inputValue())).toBeLessThanOrEqual(initialVolume - 0.04);
  } else {
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => Number(await volume.inputValue())).toBeGreaterThanOrEqual(initialVolume + 0.04);
  }

  await page.keyboard.press('/');
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
});

test('estados de loading e erro permitem retry no desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  let libraryRequests = 0;
  await page.route('**/api/library', async route => {
    libraryRequests += 1;
    if (libraryRequests === 1) {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Biblioteca E2E temporariamente indisponível' })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByTestId('responsive-state-loading')).toBeVisible();
  const errorState = page.getByTestId('responsive-state-error');
  await expect(errorState).toBeVisible();
  await expect(errorState).toContainText('Biblioteca E2E temporariamente indisponível');
  await errorState.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  await expect(page.getByTestId('responsive-state-error')).toHaveCount(0);
});