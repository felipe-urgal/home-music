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

  await detail.getByRole('button', { name: 'Biblioteca' }).click();
  await expect(libraryHome).toBeVisible();

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
  const nextTrackCard = page.locator('.queue-panel__toggle');

  await expect(player).toBeVisible();
  await expect(topbar.getByRole('button', { name: 'Biblioteca' })).toBeVisible();
  await expect(topbar.getByRole('button', { name: 'Mais opções da faixa' })).toBeVisible();
  await expect(heroPlay).toBeVisible();
  await expect(heroControl).toBeVisible();
  await expect(controls).toBeHidden();
  await expect(page.locator('.player-mobile-playlist-action')).toHaveCount(0);
  await expect(page.getByLabel('Progresso da música')).toBeEnabled();
  await expect(nextTrackCard).toBeVisible();
  await expect(nextTrackCard).toHaveAttribute('aria-label', /Tocar próxima música:/);

  const viewport = page.viewportSize()!;
  const boxes = await Promise.all([artwork, heading, progress, nextTrackCard].map(locator => locator.boundingBox()));
  const [artworkBox, headingBox, progressBox, nextCardBox] = boxes;
  expect(artworkBox && headingBox && progressBox && nextCardBox).toBeTruthy();
  expect(artworkBox!.x).toBeLessThanOrEqual(1);
  expect(artworkBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(artworkBox!.height).toBeGreaterThanOrEqual(viewport.height * 0.6);
  expect(headingBox!.y).toBeGreaterThan(artworkBox!.y + artworkBox!.height - 16);
  expect(progressBox!.y).toBeGreaterThan(headingBox!.y);
  expect(nextCardBox!.y).toBeGreaterThan(progressBox!.y);
  expect(viewport.height - (nextCardBox!.y + nextCardBox!.height)).toBeLessThanOrEqual(32);

  if (await heroPlay.getAttribute('aria-label') === 'Tocar pela capa') {
    await heroPlay.click();
  }
  await expect(heroPlay).toHaveAttribute('aria-label', 'Pausar pela capa');
  await expect(heroControl).toHaveClass(/is-hidden/, { timeout: 3_000 });

  const nextTrackLabel = await nextTrackCard.getAttribute('aria-label');
  const nextTrackTitle = nextTrackLabel?.replace('Tocar próxima música: ', '');
  expect(nextTrackTitle).toBeTruthy();

  await nextTrackCard.click();
  await expect(page.getByRole('dialog', { name: 'Fila de reprodução' })).toHaveCount(0);
  await expect(heading.locator('h1')).toHaveText(nextTrackTitle!);

  await topbar.getByRole('button', { name: 'Mais opções da faixa' }).click();
  await expect(page.getByRole('menu', { name: 'Mais opções da faixa' }).getByText('Adicionar à playlist')).toBeVisible();

  const overflow = await playerSurface.evaluate(element => element.scrollHeight - element.clientHeight);
  expect(overflow).toBeLessThanOrEqual(1);
});
