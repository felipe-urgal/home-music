import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

function viewportWidth(page: Page) {
  const width = page.viewportSize()?.width;
  if (!width) throw new Error('Viewport E2E não configurada.');
  return width;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill(adminUsername);
  await page.getByLabel('Senha', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openAdministration(page: Page) {
  const width = viewportWidth(page);
  if (width >= 1024) {
    const sidebar = page.getByTestId('desktop-sidebar');
    await expect(sidebar.getByRole('button', { name: /^Administração/ })).toHaveCount(0);
    await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  } else {
    if (width < 700) {
      await page.getByRole('navigation', { name: 'Navegação principal' })
        .getByRole('button', { name: 'Conta', exact: true }).click();
    } else {
      const backToLibrary = page.getByRole('button', { name: 'Voltar à biblioteca', exact: true });
      if (await backToLibrary.isVisible()) await backToLibrary.click();
      await page.getByRole('button', { name: /Minha conta ·/ }).click();
    }
  }
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
}

test('admin desativa e reativa faixa preservando relações e estado após rescan', async ({ page }, testInfo) => {
  await login(page);

  const request = page.context().request;
  const libraryResponse = await request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as { tracks: Array<{ id: string; title: string }> };
  const track = library.tracks[0];
  expect(track).toBeTruthy();

  const originalFavoritesResponse = await request.get('/api/favorites');
  expect(originalFavoritesResponse.ok()).toBeTruthy();
  const originalFavorites = await originalFavoritesResponse.json() as { trackIds: string[] };
  const addedFavorite = !originalFavorites.trackIds.includes(track.id);
  let playlistId: string | null = null;

  try {
    if (addedFavorite) {
      const favoriteResponse = await request.put(`/api/favorites/${encodeURIComponent(track.id)}`, {
        headers: mutationHeaders,
        data: { favorite: true }
      });
      expect(favoriteResponse.ok()).toBeTruthy();
    }

    const playlistName = `Availability ${testInfo.project.name} r${testInfo.retry}`;
    const playlistResponse = await request.post('/api/playlists', {
      headers: mutationHeaders,
      data: { name: playlistName }
    });
    expect(playlistResponse.ok()).toBeTruthy();
    const playlistPayload = await playlistResponse.json() as { playlist: { id: string } };
    playlistId = playlistPayload.playlist.id;

    const setTracksResponse = await request.put(`/api/playlists/${playlistId}/tracks`, {
      headers: mutationHeaders,
      data: { trackIds: [track.id] }
    });
    expect(setTracksResponse.ok()).toBeTruthy();

    await openAdministration(page);
    await page.getByRole('button', { name: /^Gerenciar músicas/ }).click();
    await expect(page.locator('#admin-tracks-title')).toHaveText('Gerenciar músicas');

    const row = page.locator('.admin-track-row').filter({ hasText: track.title }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Ativa');
    await row.getByRole('button', { name: 'Desativar', exact: true }).click();
    await expect(row).toContainText('Desativada');
    await expect(row.getByRole('button', { name: 'Reativar', exact: true })).toBeVisible();

    const hiddenLibrary = await request.get('/api/library');
    const hiddenPayload = await hiddenLibrary.json() as { tracks: Array<{ id: string }> };
    expect(hiddenPayload.tracks.some(item => item.id === track.id)).toBeFalsy();

    const blockedStream = await request.get(`/api/tracks/${encodeURIComponent(track.id)}/stream`);
    expect(blockedStream.status()).toBe(404);

    const favoritesResponse = await request.get('/api/favorites');
    const favorites = await favoritesResponse.json() as { trackIds: string[] };
    expect(favorites.trackIds).toContain(track.id);

    const playlistsResponse = await request.get('/api/playlists');
    const playlists = await playlistsResponse.json() as { playlists: Array<{ id: string; trackIds: string[] }> };
    expect(playlists.playlists.find(item => item.id === playlistId)?.trackIds).toContain(track.id);

    const scanResponse = await request.post('/api/library/scan', { headers: mutationHeaders });
    expect(scanResponse.ok()).toBeTruthy();
    const adminTracksAfterScan = await request.get('/api/admin/tracks');
    const adminPayload = await adminTracksAfterScan.json() as { tracks: Array<{ id: string; enabled: boolean }> };
    expect(adminPayload.tracks.find(item => item.id === track.id)?.enabled).toBe(false);

    await page.getByRole('button', { name: 'Atualizar músicas', exact: true }).click();
    await expect(row).toContainText('Desativada');
    await row.getByRole('button', { name: 'Reativar', exact: true }).click();
    await expect(row).toContainText('Ativa');

    const restoredLibrary = await request.get('/api/library');
    const restoredPayload = await restoredLibrary.json() as { tracks: Array<{ id: string }> };
    expect(restoredPayload.tracks.some(item => item.id === track.id)).toBeTruthy();
  } finally {
    await request.patch(`/api/admin/tracks/${encodeURIComponent(track.id)}`, {
      headers: mutationHeaders,
      data: { enabled: true }
    }).catch(() => undefined);

    if (addedFavorite) {
      await request.put(`/api/favorites/${encodeURIComponent(track.id)}`, {
        headers: mutationHeaders,
        data: { favorite: false }
      }).catch(() => undefined);
    }

    if (playlistId) {
      await request.delete(`/api/playlists/${playlistId}`, {
        headers: mutationHeaders
      }).catch(() => undefined);
    }
  }
});
