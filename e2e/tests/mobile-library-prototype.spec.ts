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
  await expect(page.locator('.player-screen-immersive')).toBeVisible();
  await expect(page.locator('.player-hero-play')).toBeVisible();
  await expect(page.locator('.controls').getByRole('button', { name: 'Anterior' })).toBeVisible();
  await expect(page.locator('.controls').getByRole('button', { name: 'Próxima' })).toBeVisible();
  await expect(page.locator('.controls').getByRole('button', { name: 'Aleatório' })).toBeHidden();
  await expect(page.locator('.controls').getByRole('button', { name: /Repet/ })).toBeHidden();
});
