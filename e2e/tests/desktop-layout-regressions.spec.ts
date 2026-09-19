import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('player desktop usa navbar superior e mantém superfícies utilitárias livres', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < 1024, 'Regressão específica do layout desktop.');

  const topbar = page.getByTestId('desktop-sidebar');
  const playerBar = page.getByTestId('desktop-player-bar');
  const navigation = topbar.getByRole('navigation', { name: 'Navegação principal' });
  const nowPlaying = page.locator('.desktop-now-playing-screen');
  const nowPlayingArt = page.locator('.desktop-now-playing-screen__art');
  const nowPlayingContent = page.locator('.desktop-now-playing-screen__content');

  await expect(nowPlayingArt).toBeVisible();
  await expect(nowPlayingContent).toBeVisible();

  const nowPlayingBox = await nowPlaying.boundingBox();
  const artworkBox = await nowPlayingArt.boundingBox();
  const contentBox = await nowPlayingContent.boundingBox();
  expect(nowPlayingBox).not.toBeNull();
  expect(artworkBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(artworkBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(contentBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(artworkBox!.y + artworkBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);

  await navigation.getByRole('button', { name: 'Pastas', exact: true }).click();
  await expect(page.getByText('Suas Pastas', { exact: true })).toBeVisible();
  await expect(playerBar).toBeHidden();

  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(topbarBox!.height).toBeLessThan(100);

  await topbar.getByRole('button', { name: /Minha conta/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await expect(playerBar).toBeHidden();

  await page.getByRole('button', { name: /Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await expect(playerBar).toBeHidden();

  const usersEntry = page.getByRole('button', { name: /Usuários/ });
  await usersEntry.scrollIntoViewIfNeeded();
  await expect(usersEntry).toBeVisible();
});
