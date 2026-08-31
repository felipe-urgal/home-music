import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

test('modal de playlist inteligente rola internamente e trava o fundo no mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await login(page);
  const mainNavigation = page.getByRole('navigation', { name: 'Navegação principal' });
  await mainNavigation.getByRole('button', { name: 'Biblioteca', exact: true }).click();

  const libraryNavigation = page.getByRole('navigation', { name: 'Navegação da biblioteca' });
  await libraryNavigation.getByRole('button', { name: 'Playlists', exact: true }).click();
  await page.getByRole('button', { name: 'Inteligente', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Nova playlist inteligente' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    root: document.documentElement.style.overflow,
    body: document.body.style.overflow
  }))).toEqual({ root: 'hidden', body: 'hidden' });

  const body = dialog.locator('.smart-playlist-dialog__body');
  await expect(body).toBeVisible();
  const dimensions = await body.evaluate(element => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await body.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Criar playlist', exact: true })).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    root: document.documentElement.style.overflow,
    body: document.body.style.overflow
  }))).toEqual({ root: '', body: '' });
});
