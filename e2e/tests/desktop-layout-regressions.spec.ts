import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('player desktop respeita sidebar e não cobre telas utilitárias', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < 1024, 'Regressão específica do layout desktop.');

  const sidebar = page.getByTestId('desktop-sidebar');
  const playerBar = page.getByTestId('desktop-player-bar');
  const playButton = page.getByRole('button', { name: 'Tocar', exact: true });
  if (await playButton.isVisible()) await playButton.click();

  await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();
  await expect(playerBar).toBeVisible();

  const sidebarBox = await sidebar.boundingBox();
  const playerBarBox = await playerBar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(playerBarBox).not.toBeNull();
  expect(playerBarBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width - 1);
  expect(playerBarBox!.x + playerBarBox!.width).toBeLessThanOrEqual(viewport!.width + 1);

  await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await expect(playerBar).toBeVisible();

  const accountSurfaceBox = await page.locator('.desktop-account-surface').boundingBox();
  const accountPlayerBarBox = await playerBar.boundingBox();
  expect(accountSurfaceBox).not.toBeNull();
  expect(accountPlayerBarBox).not.toBeNull();
  expect(accountSurfaceBox!.y + accountSurfaceBox!.height).toBeLessThanOrEqual(accountPlayerBarBox!.y + 1);

  await page.getByRole('button', { name: /Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await expect(playerBar).toBeVisible();

  const usersEntry = page.getByRole('button', { name: /Usuários/ });
  await expect(usersEntry).toBeVisible();
  const usersEntryBox = await usersEntry.boundingBox();
  const administrationPlayerBarBox = await playerBar.boundingBox();
  expect(usersEntryBox).not.toBeNull();
  expect(administrationPlayerBarBox).not.toBeNull();
  expect(usersEntryBox!.y + usersEntryBox!.height).toBeLessThanOrEqual(administrationPlayerBarBox!.y + 1);
});
