import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);

  const loginResponsePromise = page.waitForResponse(response =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/auth/login'
  );

  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  await expect(page.locator('main.app-shell')).toBeVisible();
}

async function assetPaths(page: Page) {
  return page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .map(entry => {
      try {
        return new URL(entry.name).pathname;
      } catch {
        return '';
      }
    })
    .filter(pathname => pathname.startsWith('/assets/')));
}

async function expectLibrary(page: Page) {
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toBeVisible();
}

async function expectAccessibilityBaseline(page: Page) {
  const search = page.getByLabel('Buscar na biblioteca');

  // Anchor on the search field, move away and return using real keyboard input.
  // The final focus therefore exercises :focus-visible instead of relying only
  // on programmatic element.focus(), whose modality differs between browsers.
  await search.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(search, 'a busca deve ser alcançável novamente pelo teclado').toBeFocused();

  const focusState = await search.evaluate(element => {
    const style = window.getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth)
    };
  });
  expect(
    focusState.focusVisible,
    'a busca focada por teclado deve corresponder a :focus-visible'
  ).toBe(true);
  expect(
    focusState.style,
    'o indicador de foco por teclado deve usar um outline visível'
  ).not.toBe('none');
  expect(
    focusState.width,
    'o indicador de foco por teclado deve ter ao menos 2px'
  ).toBeGreaterThanOrEqual(2);

  const width = page.viewportSize()?.width ?? 390;
  if (width >= 1024) {
    const desktopNavigation = page.getByTestId('desktop-sidebar').getByRole('navigation', { name: 'Navegação principal' });
    const foldersTab = desktopNavigation.getByRole('button', { name: 'Pastas', exact: true });
    await expect(
      foldersTab,
      'a navegação desktop deve expor Pastas na rota raiz da Biblioteca'
    ).toBeVisible();
    await expect(
      foldersTab,
      'a rota /library deve expor Pastas como página corrente no desktop'
    ).toHaveAttribute('aria-current', 'page');
    return;
  }

  const libraryTabs = page.locator('.library-tabs');
  await expect(
    libraryTabs,
    'as abas da Biblioteca devem estar visíveis em mobile/tablet'
  ).toBeVisible();
  const foldersTab = libraryTabs.getByRole('button', { name: 'Pastas', exact: true });
  await expect(
    foldersTab,
    'a aba Pastas deve estar visível na rota raiz da Biblioteca'
  ).toBeVisible();
  await expect(
    foldersTab,
    'a rota /library deve expor Pastas como página corrente'
  ).toHaveAttribute('aria-current', 'page');
}

async function openAccount(page: Page) {
  const width = page.viewportSize()?.width ?? 390;

  if (width >= 1024) {
    await page.getByTestId('desktop-sidebar').getByRole('button', { name: /Minha conta/ }).click();
  } else if (width >= 700) {
    await page.getByRole('button', { name: /Minha conta ·/ }).click();
  } else {
    await page.getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Conta', exact: true })
      .click();
  }

  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
}

test('smoke crítico: deep link, acessibilidade, histórico, player, conta e administração', async ({ page }) => {
  await login(page, '/library');
  await expect(page).toHaveURL(/\/library$/);
  await expectLibrary(page);
  await expectAccessibilityBaseline(page);

  expect(
    (await assetPaths(page)).some(pathname => /^\/assets\/AdministrationScreen-[^/]+\.js$/.test(pathname)),
    'o fluxo normal da biblioteca não deve baixar o chunk administrativo'
  ).toBe(false);

  const audio = page.locator('audio');
  await expect(audio).toHaveCount(1);
  await audio.evaluate(element => element.setAttribute('data-e2e-route-audio', 'preserved'));

  await openAccount(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(audio).toHaveAttribute('data-e2e-route-audio', 'preserved');
  await expect.poll(async () =>
    (await assetPaths(page)).some(pathname => /^\/assets\/MyAccountScreen-[^/]+\.js$/.test(pathname))
  ).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expectLibrary(page);
  await expect(audio).toHaveAttribute('data-e2e-route-audio', 'preserved');

  await page.goForward();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');

  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await expect(audio).toHaveAttribute('data-e2e-route-audio', 'preserved');
  await expect.poll(async () =>
    (await assetPaths(page)).some(pathname => /^\/assets\/AdministrationScreen-[^/]+\.js$/.test(pathname))
  ).toBe(true);

  await page.reload();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('#administration-title')).toHaveText('Administração');

  await page.goto('/library/playlists/playlist-inexistente');
  await expect(page).toHaveURL(/\/library\/playlists$/);
  await expect(page.locator('.library-content .section-heading').getByText('Playlists', { exact: true })).toBeVisible();

  await page.goto('/rota-invalida');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('main.app-shell')).toBeVisible();
});

test.describe('fallback de chunk lazy', () => {
  test.use({ serviceWorkers: 'block' });

  test('chunk administrativo indisponível mostra fallback recuperável', async ({ page }) => {
    await page.route(/\/assets\/AdministrationScreen-[^/]+\.js(?:\?.*)?$/, route => route.abort());
    await login(page, '/admin');

    const errorState = page.getByTestId('responsive-state-error');
    await expect(errorState).toBeVisible();
    await expect(errorState).toContainText('Não foi possível carregar esta área');
    await expect(errorState.getByRole('button', { name: 'Recarregar aplicativo' })).toBeVisible();
  });
});
