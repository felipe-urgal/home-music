import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.player-screen-immersive')).toBeVisible();
  await expect(page.locator('.player-track-heading h1')).toBeVisible();
}

test('mobile segue o protótipo 3 na biblioteca, detalhe e player', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await login(page);

  await page.getByRole('button', { name: 'Biblioteca' }).click();

  const libraryHome = page.getByTestId('mobile-library-home');
  await expect(libraryHome).toBeVisible();
  await expect(libraryHome.getByText('Pastas', { exact: true })).toBeVisible();
  await expect(libraryHome.getByText('Playlists', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegação da biblioteca' })).toBeHidden();
  await expect(page.locator('.mobile-bottom-nav')).toBeHidden();

  const miniPlayer = page.getByTestId('mini-player');
  await expect(miniPlayer).toBeVisible();
  await expect(miniPlayer.getByRole('button', { name: 'Abrir Tocando Agora' })).toBeVisible();
  await expect(miniPlayer.getByRole('button', { name: 'Adicionar à playlist' })).toBeHidden();

  const fixturePlaylist = libraryHome.getByText('E2E Rekordbox', { exact: true });
  await expect(fixturePlaylist).toBeVisible();
  await fixturePlaylist.click();

  const detail = page.getByTestId('mobile-collection-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Biblioteca' })).toBeVisible();
  const collectionHero = detail.getByRole('region', { name: 'E2E Rekordbox' });
  await expect(collectionHero.getByText('E2E Rekordbox', { exact: true })).toBeVisible();
  await expect(page.locator('.mobile-library-brand-bar')).toBeHidden();
  await expect(detail.getByPlaceholder('Buscar nesta playlist…')).toBeVisible();

  await detail.getByRole('button', { name: 'Mais opções da coleção' }).click();
  const collectionSheet = page.getByRole('dialog', { name: 'Opções de E2E Rekordbox' });
  await expect(collectionSheet).toBeVisible();
  await collectionSheet.getByRole('button', { name: 'Fechar' }).click();

  await detail.getByRole('button', { name: 'Biblioteca' }).click();
  await expect(page).toHaveURL(/\/library\/playlists$/);
  await expect(page.getByRole('button', { name: 'Nova playlist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inteligente' })).toBeVisible();

  await miniPlayer.getByRole('button', { name: 'Abrir Tocando Agora' }).click();
  const player = page.locator('.player-screen-immersive');
  const controls = page.locator('.controls');
  const playerSurface = page.locator('.desktop-layout[data-desktop-active="player"] > .phone-surface');

  const topbar = page.locator('.player-topbar');
  const artwork = page.locator('.hero-art');
  const heading = page.locator('.player-track-heading');
  const progress = page.locator('.progress-wrap');
  const heroPlay = page.locator('.player-hero-play');
  const heroControl = page.locator('.player-hero-play__control');
  const nextTrackCard = page.locator('.queue-panel__toggle-mobile');

  await expect(player).toBeVisible();
  await expect(topbar.getByRole('button', { name: 'Biblioteca' })).toBeVisible();
  await expect(topbar.getByRole('button', { name: 'Adicionar à playlist' })).toBeVisible();
  await expect(topbar.getByRole('button', { name: 'Mais opções da faixa' })).toBeVisible();
  await expect(heroPlay).toBeVisible();
  await expect(heroControl).toBeVisible();
  await expect(controls).toBeHidden();
  await expect(page.locator('.player-mobile-playlist-action')).toHaveCount(0);
  await expect(page.getByLabel('Progresso da música')).toBeEnabled();
  await expect(page.locator('.player-progress-track')).toBeVisible();
  await expect(nextTrackCard).toBeVisible();
  await expect(nextTrackCard).toHaveAttribute('aria-label', /Tocar próxima música:/);

  const viewport = page.viewportSize()!;
  const boxes = await Promise.all([artwork, heading, progress].map(locator => locator.boundingBox()));
  const [artworkBox, headingBox, progressBox] = boxes;
  expect(artworkBox && headingBox && progressBox).toBeTruthy();
  expect(artworkBox!.x).toBeLessThanOrEqual(1);
  expect(artworkBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(artworkBox!.height).toBeLessThanOrEqual(viewport.height * 0.62);
  expect(headingBox!.y).toBeGreaterThan(artworkBox!.y + artworkBox!.height - 16);
  expect(progressBox!.y).toBeGreaterThan(headingBox!.y);

  await topbar.getByRole('button', { name: 'Adicionar à playlist' }).click();
  const playlistSheet = page.getByRole('dialog', { name: 'Adicionar à playlist' });
  await expect(playlistSheet).toBeVisible();
  const playlistSheetBox = await playlistSheet.boundingBox();
  const sheetViewport = page.viewportSize()!;
  expect(playlistSheetBox).toBeTruthy();
  expect(Math.abs((playlistSheetBox!.y + playlistSheetBox!.height) - sheetViewport.height)).toBeLessThanOrEqual(2);
  await playlistSheet.getByRole('button', { name: 'Fechar' }).click();

  if (await heroPlay.getAttribute('aria-label') === 'Tocar pela capa') {
    await heroPlay.click();
  }
  await expect(heroPlay).toHaveAttribute('aria-label', 'Pausar pela capa');
  await expect(heroControl).toHaveClass(/is-hidden/, { timeout: 3_000 });
  await expect(player).toHaveAttribute('data-mobile-chrome-visible', 'false', { timeout: 3_000 });

  await player.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await expect(player).toHaveAttribute('data-mobile-chrome-visible', 'true');

  const nextTrackLabel = await nextTrackCard.getAttribute('aria-label');
  const nextTrackTitle = nextTrackLabel?.replace('Tocar próxima música: ', '');
  expect(nextTrackTitle).toBeTruthy();

  await nextTrackCard.click();
  await expect(page.getByRole('dialog', { name: 'Fila de reprodução' })).toHaveCount(0);
  await expect(heading.locator('h1')).toHaveText(nextTrackTitle!);

  const horizontalOverflow = await playerSurface.evaluate(element => element.scrollWidth - element.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 360, height: 740 });
  await player.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await nextTrackCard.scrollIntoViewIfNeeded();
  await expect(nextTrackCard).toBeVisible();
  expect(await playerSurface.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 667, height: 375 });
  await artwork.scrollIntoViewIfNeeded();
  const landscapeArtworkBox = await artwork.boundingBox();
  expect(landscapeArtworkBox).toBeTruthy();
  expect(landscapeArtworkBox!.height).toBeLessThanOrEqual(280);
  expect(await playerSurface.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});
