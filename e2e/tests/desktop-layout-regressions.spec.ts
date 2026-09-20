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
  await expect(navigation.getByRole('button', { name: 'Pastas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.library-header.is-root .library-header__title strong')).toBeHidden();
  await expect(playerBar).toBeHidden();

  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(topbarBox!.height).toBeLessThan(100);

  await navigation.getByRole('button', { name: 'Playlists', exact: true }).click();
  await expect(page.getByText('Suas Playlists', { exact: true })).toBeVisible();

  const playlistMain = page.locator('.desktop-main-content--library');
  const playlistContent = page.locator('.library-content');
  const playlistCreate = page.locator('.playlist-create-action');
  const playlistOrder = page.locator('.playlist-order-control');
  const playlistMainBox = await playlistMain.boundingBox();
  const playlistCreateBox = await playlistCreate.boundingBox();
  const playlistOrderBox = await playlistOrder.boundingBox();

  expect(playlistMainBox).not.toBeNull();
  expect(playlistMainBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  expect(await playlistContent.evaluate(element => getComputedStyle(element, '::before').display)).toBe('none');
  expect(playlistCreateBox).not.toBeNull();
  expect(playlistOrderBox).not.toBeNull();
  expect(Math.abs(
    (playlistCreateBox!.y + playlistCreateBox!.height / 2)
      - (playlistOrderBox!.y + playlistOrderBox!.height / 2)
  )).toBeLessThanOrEqual(2);

  const importedPlaylist = page.locator('.group-item__main').filter({ hasText: 'E2E Rekordbox' });
  await expect(importedPlaylist).toBeVisible();
  await importedPlaylist.click();

  const playlistDetail = page.getByTestId('desktop-playlist-detail-layout');
  const playlistSummary = page.getByTestId('desktop-playlist-summary');
  const playlistDetailMain = page.locator('.desktop-playlist-detail-main');
  const playlistTitle = playlistDetailMain.locator('.library-header__title');
  const playlistSearch = page.getByPlaceholder('Buscar nesta playlist…');
  const playlistQuickFilters = page.locator('[aria-label="Filtros rápidos da playlist"]');

  await expect(playlistDetail).toBeVisible();
  await expect(playlistSummary).toBeVisible();
  await expect(playlistSearch).toBeVisible();
  await expect(playlistQuickFilters).toBeVisible();
  await expect(playlistQuickFilters.getByRole('button', { name: 'Todas', exact: true })).toBeVisible();

  const playlistDetailBox = await playlistDetail.boundingBox();
  const playlistSummaryBox = await playlistSummary.boundingBox();
  const playlistDetailMainBox = await playlistDetailMain.boundingBox();
  const playlistTitleBox = await playlistTitle.boundingBox();
  const playlistSearchBox = await playlistSearch.boundingBox();
  const playlistFiltersBox = await playlistQuickFilters.boundingBox();

  expect(playlistDetailBox).not.toBeNull();
  expect(playlistSummaryBox).not.toBeNull();
  expect(playlistDetailMainBox).not.toBeNull();
  expect(playlistTitleBox).not.toBeNull();
  expect(playlistSearchBox).not.toBeNull();
  expect(playlistFiltersBox).not.toBeNull();
  expect(playlistDetailBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  expect(playlistSummaryBox!.x + playlistSummaryBox!.width).toBeLessThanOrEqual(playlistDetailMainBox!.x + 1);
  expect(playlistSearchBox!.y).toBeGreaterThanOrEqual(playlistTitleBox!.y + playlistTitleBox!.height);
  expect(playlistFiltersBox!.y).toBeGreaterThanOrEqual(playlistSearchBox!.y + playlistSearchBox!.height - 1);

  const collectionScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(collectionScrollWidth).toBeLessThanOrEqual(viewport!.width + 1);

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
