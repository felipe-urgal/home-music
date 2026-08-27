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
    await page.getByTestId('desktop-sidebar').getByRole('button', { name: /^Administração/ }).click();
  } else {
    if (width < 700) {
      await page.getByRole('navigation', { name: 'Navegação principal' })
        .getByRole('button', { name: 'Conta', exact: true }).click();
    } else {
      const backToLibrary = page.getByRole('button', { name: 'Voltar à biblioteca', exact: true });
      if (await backToLibrary.isVisible()) await backToLibrary.click();
      await page.getByRole('button', { name: /Minha conta ·/ }).click();
    }
    await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
    await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  }
  await expect(page.locator('#administration-title')).toHaveText('Administração');
}

test('admin move para lixeira, preserva relações após scan e restaura', async ({ page }, testInfo) => {
  await login(page);
  const request = page.context().request;

  const libraryResponse = await request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as { tracks: Array<{ id: string; title: string }> };
  const track = library.tracks.find(item => item.title === 'E2E Quarantine');
  expect(track).toBeTruthy();
  if (!track) return;

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

    const playlistResponse = await request.post('/api/playlists', {
      headers: mutationHeaders,
      data: { name: `Quarantine ${testInfo.project.name} r${testInfo.retry}` }
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
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Mover para lixeira', exact: true }).click();
    await expect(row).toHaveCount(0);

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
    const quarantineAfterScan = await request.get('/api/admin/quarantine');
    expect(quarantineAfterScan.ok()).toBeTruthy();
    const quarantinePayload = await quarantineAfterScan.json() as { tracks: Array<{ id: string }> };
    expect(quarantinePayload.tracks.some(item => item.id === track.id)).toBeTruthy();

    const libraryAfterScan = await request.get('/api/library');
    const libraryAfterScanPayload = await libraryAfterScan.json() as { tracks: Array<{ id: string }> };
    expect(libraryAfterScanPayload.tracks.some(item => item.id === track.id)).toBeFalsy();

    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(page.locator('#administration-title')).toHaveText('Administração');
    await page.getByRole('button', { name: /^Lixeira/ }).click();
    await expect(page.locator('#admin-quarantine-title')).toHaveText('Lixeira');

    const trashRow = page.locator('.admin-quarantine-row').filter({ hasText: track.title }).first();
    await expect(trashRow).toBeVisible();
    await trashRow.getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(trashRow).toHaveCount(0);

    const restoredLibrary = await request.get('/api/library');
    const restoredPayload = await restoredLibrary.json() as { tracks: Array<{ id: string }> };
    expect(restoredPayload.tracks.some(item => item.id === track.id)).toBeTruthy();

    const restoredFavorites = await request.get('/api/favorites');
    const restoredFavoritePayload = await restoredFavorites.json() as { trackIds: string[] };
    expect(restoredFavoritePayload.trackIds).toContain(track.id);
  } finally {
    const quarantineResponse = await request.get('/api/admin/quarantine').catch(() => null);
    if (quarantineResponse?.ok()) {
      const payload = await quarantineResponse.json() as { tracks: Array<{ id: string }> };
      if (payload.tracks.some(item => item.id === track.id)) {
        await request.post(`/api/admin/quarantine/${encodeURIComponent(track.id)}/restore`, {
          headers: mutationHeaders
        }).catch(() => undefined);
      }
    }

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
