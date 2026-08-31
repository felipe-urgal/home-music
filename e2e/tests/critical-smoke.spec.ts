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

async function expectLibrary(page: Page) {
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toBeVisible();
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

test('smoke crítico: deep link, histórico, player, conta e administração', async ({ page }) => {
  await login(page, '/library');
  await expect(page).toHaveURL(/\/library$/);
  await expectLibrary(page);

  const audio = page.locator('audio');
  await expect(audio).toHaveCount(1);
  await audio.evaluate(element => element.setAttribute('data-e2e-route-audio', 'preserved'));

  await openAccount(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(audio).toHaveAttribute('data-e2e-route-audio', 'preserved');

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

  await page.reload();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('#administration-title')).toHaveText('Administração');
});
