import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

test('biblioteca mobile usa abas no topo e mini-player persistente', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await login(page);

  const openLibrary = page.getByRole('button', { name: 'Abrir biblioteca' });
  await expect(openLibrary).toBeVisible();
  await openLibrary.click();

  const libraryTabs = page.getByRole('navigation', { name: 'Navegação da biblioteca' });
  await expect(libraryTabs).toBeVisible();
  await expect(libraryTabs.getByRole('button', { name: 'Pastas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.mobile-bottom-nav')).toBeHidden();

  const miniPlayer = page.getByTestId('mini-player');
  await expect(miniPlayer).toBeVisible();
  await expect(miniPlayer.getByRole('button', { name: 'Abrir Tocando Agora' })).toBeVisible();

  await libraryTabs.getByRole('button', { name: 'Playlists', exact: true }).click();
  await expect(libraryTabs.getByRole('button', { name: 'Playlists', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/\/library\/playlists$/);

  await miniPlayer.getByRole('button', { name: 'Abrir Tocando Agora' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
});
