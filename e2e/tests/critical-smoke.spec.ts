import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
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

async function openLibrary(page: Page) {
  const width = page.viewportSize()?.width ?? 390;

  if (width >= 1024) {
    const sidebar = page.getByTestId('desktop-sidebar');
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();
  } else if (width >= 700) {
    await page.getByRole('button', { name: 'Voltar à biblioteca', exact: true }).click();
  } else {
    const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
    await expect(navigation).toBeVisible();
    await navigation.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  }

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

test('smoke crítico: login, biblioteca, conta e administração', async ({ page }) => {
  await login(page);
  await openLibrary(page);
  await openAccount(page);

  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
});
