import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill(adminUsername);
  await page.getByLabel('Senha', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openAdministration(page: Page) {
  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
}

async function selectTracks(page: Page, titles: string[]) {
  for (const title of titles) {
    await page.getByRole('checkbox', { name: `Selecionar ${title}` }).check();
  }
  await expect(page.getByTestId('admin-bulk-toolbar')).toContainText(`${titles.length} selecionadas`);
}

test('admin executa ações em lote reversíveis e confirma exclusão permanente', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  const request = page.context().request;
  const titles = ['E2E Zeta', 'E2E Zulu'];

  const libraryResponse = await request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as { tracks: Array<{ id: string; title: string }> };
  const tracks = titles.map(title => library.tracks.find(track => track.title === title));
  expect(tracks.every(Boolean)).toBeTruthy();
  const trackIds = tracks.map(track => track!.id);

  const favoritesResponse = await request.get('/api/favorites');
  expect(favoritesResponse.ok()).toBeTruthy();
  const originalFavorites = await favoritesResponse.json() as { trackIds: string[] };
  const originallyFavorite = new Set(originalFavorites.trackIds);

  const playlistResponse = await request.post('/api/playlists', {
    headers: mutationHeaders,
    data: { name: `Bulk actions ${testInfo.retry}` }
  });
  expect(playlistResponse.ok()).toBeTruthy();
  const playlistPayload = await playlistResponse.json() as { playlist: { id: string; name: string } };
  const playlistId = playlistPayload.playlist.id;

  try {
    await openAdministration(page);
    await page.getByRole('button', { name: /^Gerenciar músicas/ }).click();
    await expect(page.locator('#admin-tracks-title')).toHaveText('Gerenciar músicas');

    await selectTracks(page, titles);
    await page.getByTestId('admin-bulk-toolbar').getByRole('button', { name: 'Desativar 2', exact: true }).click();
    for (const title of titles) {
      await expect(page.locator('.admin-track-row').filter({ hasText: title })).toContainText('Desativada');
    }
    await expect(page.getByRole('checkbox', { name: 'Selecionar E2E Zeta' })).not.toBeChecked();

    await selectTracks(page, titles);
    await page.getByTestId('admin-bulk-toolbar').getByRole('button', { name: 'Reativar 2', exact: true }).click();
    for (const title of titles) {
      await expect(page.locator('.admin-track-row').filter({ hasText: title })).toContainText('Ativa');
    }

    await selectTracks(page, titles);
    const favoriteButton = page.getByTestId('admin-bulk-toolbar').getByRole('button', { name: /Favoritar/ });
    if (await favoriteButton.isEnabled()) await favoriteButton.click();
    const favoritesAfter = await request.get('/api/favorites');
    const favoritesPayload = await favoritesAfter.json() as { trackIds: string[] };
    expect(trackIds.every(id => favoritesPayload.trackIds.includes(id))).toBeTruthy();

    await selectTracks(page, titles);
    const bulkToolbar = page.getByTestId('admin-bulk-toolbar');
    await bulkToolbar.getByLabel('Playlist para seleção').selectOption(playlistId);
    await bulkToolbar.getByRole('button', { name: 'Adicionar 2', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Selecionar E2E Zeta' })).not.toBeChecked();

    const playlistsAfter = await request.get('/api/playlists');
    const playlistsPayload = await playlistsAfter.json() as { playlists: Array<{ id: string; trackIds: string[] }> };
    const updatedPlaylist = playlistsPayload.playlists.find(playlist => playlist.id === playlistId);
    expect(updatedPlaylist).toBeTruthy();
    expect(trackIds.every(id => updatedPlaylist!.trackIds.includes(id))).toBeTruthy();

    await selectTracks(page, titles);
    page.once('dialog', dialog => dialog.accept());
    await page.getByTestId('admin-bulk-toolbar').getByRole('button', { name: 'Lixeira 2', exact: true }).click();
    for (const title of titles) {
      await expect(page.locator('.admin-track-row').filter({ hasText: title })).toHaveCount(0);
    }

    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.getByRole('button', { name: /^Lixeira/ }).click();
    await expect(page.locator('#admin-quarantine-title')).toHaveText('Lixeira');

    await selectTracks(page, titles);
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      expect(dialog.message()).toContain('EXCLUIR PERMANENTEMENTE');
      await dialog.accept('CANCELAR');
    });
    await page.getByTestId('admin-bulk-toolbar').getByRole('button', { name: 'Excluir 2', exact: true }).click();
    for (const title of titles) {
      await expect(page.locator('.admin-quarantine-row').filter({ hasText: title })).toBeVisible();
    }

    await page.getByTestId('admin-bulk-toolbar').getByRole('button', { name: 'Restaurar 2', exact: true }).click();
    for (const title of titles) {
      await expect(page.locator('.admin-quarantine-row').filter({ hasText: title })).toHaveCount(0);
    }

    const restoredLibrary = await request.get('/api/library');
    const restoredPayload = await restoredLibrary.json() as { tracks: Array<{ id: string }> };
    expect(trackIds.every(id => restoredPayload.tracks.some(track => track.id === id))).toBeTruthy();
  } finally {
    const quarantineResponse = await request.get('/api/admin/quarantine').catch(() => null);
    if (quarantineResponse?.ok()) {
      const quarantine = await quarantineResponse.json() as { tracks: Array<{ id: string }> };
      for (const trackId of trackIds) {
        if (quarantine.tracks.some(track => track.id === trackId)) {
          await request.post(`/api/admin/quarantine/${encodeURIComponent(trackId)}/restore`, {
            headers: mutationHeaders
          }).catch(() => undefined);
        }
      }
    }

    for (const trackId of trackIds) {
      await request.patch(`/api/admin/tracks/${encodeURIComponent(trackId)}`, {
        headers: mutationHeaders,
        data: { enabled: true }
      }).catch(() => undefined);

      if (!originallyFavorite.has(trackId)) {
        await request.put(`/api/favorites/${encodeURIComponent(trackId)}`, {
          headers: mutationHeaders,
          data: { favorite: false }
        }).catch(() => undefined);
      }
    }

    await request.delete(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      headers: mutationHeaders
    }).catch(() => undefined);
  }
});
