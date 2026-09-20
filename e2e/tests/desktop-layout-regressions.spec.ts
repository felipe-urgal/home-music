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
  const nowPlayingSurface = page.locator('.desktop-now-playing-surface');
  const nowPlaying = page.locator('.desktop-now-playing-screen');
  const nowPlayingArt = page.locator('.desktop-now-playing-screen__art');
  const nowPlayingArtworkSurface = page.locator('.desktop-now-playing-screen__art .now-playing-vinyl__disc');
  const nowPlayingContent = page.locator('.desktop-now-playing-screen__content');

  await expect(nowPlayingArt).toBeVisible();
  await expect(nowPlayingArtworkSurface).toBeVisible();
  await expect(nowPlayingArt.locator('.artwork-fallback__label')).toBeVisible();
  await expect(nowPlayingContent).toBeVisible();

  const surfaceBox = await nowPlayingSurface.boundingBox();
  const nowPlayingBox = await nowPlaying.boundingBox();
  const artworkBox = await nowPlayingArt.boundingBox();
  const artworkSurfaceBox = await nowPlayingArtworkSurface.boundingBox();
  const contentBox = await nowPlayingContent.boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(nowPlayingBox).not.toBeNull();
  expect(artworkBox).not.toBeNull();
  expect(artworkSurfaceBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(surfaceBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(artworkSurfaceBox!.width).toBeGreaterThanOrEqual(300);
  expect(artworkSurfaceBox!.height).toBeGreaterThanOrEqual(300);
  expect(artworkBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(contentBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(artworkBox!.y + artworkBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);

  const navItems = await Promise.all(
    ['Tocando Agora', 'Pastas', 'Playlists'].map(async name => {
      const box = await navigation.getByRole('button', { name, exact: true }).boundingBox();
      expect(box).not.toBeNull();
      return box!;
    })
  );
  const navCenters = navItems.map(box => box.y + box.height / 2);
  expect(Math.max(...navCenters) - Math.min(...navCenters)).toBeLessThanOrEqual(2);

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
