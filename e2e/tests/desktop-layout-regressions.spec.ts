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
  const homeBrand = topbar.getByRole('button', { name: 'Abrir Tocando Agora' });
  const nowPlayingSurface = page.locator('.desktop-now-playing-surface');
  const nowPlaying = page.locator('.desktop-now-playing-screen');
  const nowPlayingArt = page.locator('.desktop-now-playing-screen__art');
  const nowPlayingArtworkSurface = page.locator('.desktop-now-playing-screen__art .now-playing-vinyl__disc');
  const nowPlayingArtFrame = page.locator('.desktop-now-playing-screen__art-frame');
  const nowPlayingContent = page.locator('.desktop-now-playing-screen__content');
  const waveformSeek = page.locator('.desktop-now-playing-screen__waveform-seek');
  const waveformBar = page.locator('.desktop-now-playing-screen__waveform span').first();
  const coverPlay = page.locator('.desktop-now-playing-screen__cover-play');
  const moreActions = nowPlaying.getByRole('button', { name: 'Mais opções da faixa' });
  const playerModeControls = page.locator('.desktop-now-playing-screen__controls');

  await expect(nowPlayingArt).toBeVisible();
  await expect(nowPlayingArtworkSurface).toBeVisible();
  await expect(nowPlayingArt.locator('.artwork-fallback__label')).toBeVisible();
  await expect(nowPlayingContent).toBeVisible();
  await expect(waveformSeek).toBeVisible();
  await expect(waveformSeek).toHaveAttribute('aria-label', 'Progresso da música');
  await expect(waveformSeek).toHaveAttribute('aria-valuetext', /\d+:\d{2} de \d+:\d{2}/);
  await expect(waveformBar).toHaveAttribute('style', /--wave-fill:/);
  await expect(page.locator('.desktop-now-playing-screen__progress')).toHaveCount(0);
  await expect(coverPlay).toBeVisible();
  await expect(coverPlay).toHaveAttribute('aria-label', /Tocar|Pausar/);
  await expect(playerModeControls).toHaveCount(0);
  await expect(page.locator('.desktop-now-playing-screen__play')).toHaveCount(0);
  await expect(nowPlaying.getByRole('button', { name: 'Adicionar à playlist' })).toHaveCount(0);
  await moreActions.click();
  const moreMenu = page.getByRole('menu', { name: 'Mais opções da faixa' });
  await expect(moreMenu).toBeVisible();
  await expect(moreMenu).toHaveClass(/desktop-now-playing-screen__more-menu--portal/);
  await expect(moreMenu.getByRole('menuitem', { name: 'Adicionar à playlist' })).toBeVisible();
  await expect(moreMenu.getByRole('menuitemcheckbox', { name: /Aleatório/ })).toBeVisible();
  await expect(moreMenu.getByRole('menuitem', { name: /Repetição|Repetir/ })).toBeVisible();
  expect(await moreMenu.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  expect(await moreMenu.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');

  await moreMenu.getByRole('menuitem', { name: 'Adicionar à playlist' }).click();
  await expect(moreMenu.getByRole('group', { name: 'Adicionar à playlist' })).toBeVisible();
  const scrollWidthWithPlaylistMenu = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidthWithPlaylistMenu).toBeLessThanOrEqual(viewport!.width + 1);

  await nowPlaying.locator('.desktop-now-playing-screen__heading').click();
  await expect(moreMenu).toHaveCount(0);

  await moreActions.click();
  await expect(moreMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moreMenu).toHaveCount(0);

  await expect(nowPlaying.getByRole('button', { name: 'Anterior', exact: true })).toHaveCount(0);
  await expect(nowPlaying.getByRole('button', { name: 'Próxima', exact: true })).toHaveCount(0);

  const surfaceBox = await nowPlayingSurface.boundingBox();
  const nowPlayingBox = await nowPlaying.boundingBox();
  const artworkBox = await nowPlayingArt.boundingBox();
  const artworkSurfaceBox = await nowPlayingArtworkSurface.boundingBox();
  const artFrameBox = await nowPlayingArtFrame.boundingBox();
  const coverPlayBox = await coverPlay.boundingBox();
  const contentBox = await nowPlayingContent.boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(nowPlayingBox).not.toBeNull();
  expect(artworkBox).not.toBeNull();
  expect(artworkSurfaceBox).not.toBeNull();
  expect(artFrameBox).not.toBeNull();
  expect(coverPlayBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(surfaceBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(artworkSurfaceBox!.width).toBeGreaterThanOrEqual(300);
  expect(artworkSurfaceBox!.height).toBeGreaterThanOrEqual(300);
  expect(artFrameBox!.width).toBeGreaterThanOrEqual(artworkSurfaceBox!.width - 1);
  expect(coverPlayBox!.x).toBeGreaterThanOrEqual(artworkSurfaceBox!.x);
  expect(coverPlayBox!.y).toBeGreaterThanOrEqual(artworkSurfaceBox!.y);
  expect(coverPlayBox!.x + coverPlayBox!.width).toBeLessThanOrEqual(artworkSurfaceBox!.x + artworkSurfaceBox!.width + 1);
  expect(coverPlayBox!.y + coverPlayBox!.height).toBeLessThanOrEqual(artworkSurfaceBox!.y + artworkSurfaceBox!.height + 1);
  expect(artworkBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(contentBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(artworkBox!.y + artworkBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);

  await expect(homeBrand).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'Tocando Agora', exact: true })).toHaveCount(0);

  await expect(navigation.getByRole('button', { name: 'Pastas', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Playlists', exact: true })).toHaveCount(0);

  await navigation.getByRole('button', { name: 'Pastas', exact: true }).click();
  await expect(navigation.getByRole('button', { name: 'Pastas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.library-header.is-root .library-header__title strong')).toBeHidden();
  await expect(page.locator('.library-header__folder-meta select')).toHaveCount(0);
  await expect(page.locator('.folder-order-control')).toBeHidden();
  await expect(playerBar).toBeHidden();

  const folderMain = page.locator('.desktop-main-content--library');
  const folderContent = page.locator('.library-content');
  const folderMainBox = await folderMain.boundingBox();
  const folderContentBox = await folderContent.boundingBox();
  expect(folderMainBox).not.toBeNull();
  expect(folderContentBox).not.toBeNull();
  expect(folderMainBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  expect(folderContentBox!.width).toBeGreaterThanOrEqual(folderMainBox!.width * 0.95);

  await topbar.getByRole('button', { name: 'Buscar na biblioteca' }).click();
  const librarySearch = page.locator('.search-box--library input');
  await expect(librarySearch).toBeFocused();
  await librarySearch.fill('E2E Track');
  const searchResultGrid = page.getByTestId('desktop-track-grid');
  await expect(searchResultGrid).toBeVisible();
  await expect(searchResultGrid.locator('.desktop-track-card').filter({ hasText: 'E2E Track' })).toBeVisible();
  await expect(page.getByTestId('desktop-library-table')).toHaveCount(0);
  const searchTrackControl = searchResultGrid.locator('.desktop-track-card__main').filter({ hasText: 'E2E Track' });
  await expect(searchTrackControl).toHaveAttribute('aria-label', /^(Tocar|Pausar) E2E Track,/);
  await librarySearch.clear();

  await homeBrand.click();
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  await expect(homeBrand).toHaveAttribute('aria-current', 'page');
  await navigation.getByRole('button', { name: 'Pastas', exact: true }).click();

  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(topbarBox!.height).toBeLessThan(100);

  const rootHeading = page.locator('.section-heading--folders-root');
  const playlistCreate = rootHeading.getByRole('button', { name: 'Nova playlist' });
  const collectionGrid = page.locator('.library-collection-grid');
  const playlistCreateBox = await playlistCreate.boundingBox();
  const collectionGridBox = await collectionGrid.boundingBox();

  await expect(playlistCreate).toBeVisible();
  await expect(rootHeading.locator(':scope > span')).toHaveCount(0);
  await expect(rootHeading.locator(':scope > small')).toHaveCount(0);
  await expect(rootHeading.locator('.folder-order-control')).toHaveCount(0);
  await expect(page.locator('.desktop-library-playlists')).toHaveCount(0);
  expect(playlistCreateBox).not.toBeNull();
  expect(collectionGridBox).not.toBeNull();
  expect(collectionGridBox!.width).toBeGreaterThanOrEqual(folderMainBox!.width * 0.95);

  const importedPlaylist = collectionGrid.locator('.playlist-visual-card .group-item__main').filter({ hasText: 'E2E Rekordbox' });
  await expect(importedPlaylist).toBeVisible();
  await importedPlaylist.click();

  const playlistDetail = page.getByTestId('desktop-playlist-detail-layout');
  const playlistSummary = page.getByTestId('desktop-playlist-summary');
  const playlistDetailMain = page.locator('.desktop-playlist-detail-main');
  const playlistCoverPlayback = playlistSummary.getByRole('button', { name: /Tocar playlist|Pausar playlist/ });

  await expect(playlistDetail).toBeVisible();
  await expect(playlistSummary).toBeVisible();
  await expect(playlistCoverPlayback).toBeVisible();
  await expect(playlistCoverPlayback).toBeDisabled();
  await expect(playlistDetailMain.locator('.library-header.is-detail')).toHaveCount(0);
  await expect(page.getByPlaceholder('Buscar nesta playlist…')).toHaveCount(0);
  await expect(page.locator('[aria-label="Filtros rápidos da playlist"]')).toHaveCount(0);
  await expect(playlistDetailMain.getByText('Nenhuma música encontrada.', { exact: true })).toBeVisible();
  await expect(playlistDetailMain.getByTestId('desktop-track-grid')).toHaveCount(0);

  const playlistDetailBox = await playlistDetail.boundingBox();
  const playlistSummaryBox = await playlistSummary.boundingBox();
  const playlistDetailMainBox = await playlistDetailMain.boundingBox();
  const playlistCoverBox = await playlistCoverPlayback.boundingBox();

  expect(playlistDetailBox).not.toBeNull();
  expect(playlistSummaryBox).not.toBeNull();
  expect(playlistDetailMainBox).not.toBeNull();
  expect(playlistCoverBox).not.toBeNull();
  expect(playlistDetailBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  expect(playlistSummaryBox!.x + playlistSummaryBox!.width).toBeLessThanOrEqual(playlistDetailMainBox!.x + 1);
  expect(playlistCoverBox!.width).toBeGreaterThanOrEqual(220);

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
