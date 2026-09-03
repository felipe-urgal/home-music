import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

type LibraryTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
};

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(adminUsername);
  await page.getByLabel('Senha', { exact: true }).fill(adminPassword);

  const loginResponsePromise = page.waitForResponse(response =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/auth/login'
  );

  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  await expect(page.locator('main.app-shell')).toBeVisible();
}

async function openAdministration(page: Page) {
  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
}

async function playFixtureTrack(page: Page, title: string) {
  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();
  const table = page.getByTestId('desktop-library-table');
  await expect(table).toBeVisible();
  await table.getByRole('button', { name: new RegExp(`^Tocar ${title},`) }).click();
  await expect(page.getByTestId('desktop-player-bar')).toContainText(title);
}

test('override de metadata atualiza player e saúde sem alterar o arquivo e sobrevive a rescan', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  const request = page.context().request;
  let trackId: string | undefined;

  try {
    const dirtyLibraryResponse = await request.get('/api/library');
    expect(dirtyLibraryResponse.ok()).toBeTruthy();
    const dirtyLibrary = await dirtyLibraryResponse.json() as { tracks: LibraryTrack[] };
    const dirtyTrack = dirtyLibrary.tracks.find(item =>
      item.title === 'E2E Track' || item.title.startsWith('E2E Track Override ')
    );
    expect(dirtyTrack, 'a fixture E2E deve existir mesmo se um retry anterior deixou override').toBeTruthy();
    trackId = dirtyTrack!.id;

    await request.delete(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
      headers: mutationHeaders
    }).catch(() => undefined);

    const cleanLibraryResponse = await request.get('/api/library');
    expect(cleanLibraryResponse.ok()).toBeTruthy();
    const cleanLibrary = await cleanLibraryResponse.json() as { tracks: LibraryTrack[] };
    const track = cleanLibrary.tracks.find(item => item.id === trackId);
    expect(track, 'a fixture E2E deve continuar publicada após restaurar os metadados físicos').toBeTruthy();
    expect(track!.title).toBe('E2E Track');

    await playFixtureTrack(page, track!.title);
    const playerBar = page.getByTestId('desktop-player-bar');
    await expect(playerBar).toContainText(track!.title);
    await expect(playerBar).toContainText(track!.artist);

    const initialOverviewResponse = await request.get('/api/admin/library/overview');
    expect(initialOverviewResponse.ok()).toBeTruthy();
    const initialOverview = await initialOverviewResponse.json() as {
      problems: { unknownArtist: number; unknownAlbum: number };
    };
    expect(initialOverview.problems.unknownArtist).toBeGreaterThan(0);
    expect(initialOverview.problems.unknownAlbum).toBeGreaterThan(0);

    await openAdministration(page);
    const artistAttention = page.locator('.administration-cockpit-attention__items button')
      .filter({ hasText: 'Artista desconhecido' });
    await expect(artistAttention).toBeVisible();
    await expect(artistAttention.locator('strong')).toHaveText(initialOverview.problems.unknownArtist.toLocaleString('pt-BR'));
    await artistAttention.click();

    await expect(page.locator('#admin-metadata-title')).toHaveText('Metadados');
    const healthFilter = page.locator('.admin-metadata-health-filter');
    await expect(healthFilter).toContainText('Artista desconhecido');
    await expect(healthFilter).toContainText(`${initialOverview.problems.unknownArtist.toLocaleString('pt-BR')} faixas sinalizadas`);

    const row = page.locator('.admin-metadata-row').filter({ hasText: track!.title }).first();
    await expect(row).toBeVisible();
    await row.click();

    const editor = page.locator('.admin-metadata-side-editor__form');
    await expect(editor).toBeVisible();
    const titleInput = editor.getByLabel('Título');
    const artistInput = editor.getByLabel('Artista', { exact: true });
    const albumInput = editor.getByLabel('Álbum', { exact: true });
    const albumArtistInput = editor.getByLabel('Artista do álbum');
    await expect(titleInput).toHaveValue(track!.title);
    await expect(editor).toContainText(`Arquivo original: ${track!.title}`);

    const editedTitle = `E2E Track Override ${testInfo.retry}`;
    const editedArtist = 'Artista E2E corrigido';
    const editedAlbum = 'Álbum E2E corrigido';
    await titleInput.fill(editedTitle);
    await artistInput.fill(editedArtist);
    await albumInput.fill(editedAlbum);
    await albumArtistInput.fill(editedArtist);
    await editor.getByRole('button', { name: 'Salvar texto', exact: true }).click();
    await expect(editor.getByRole('status')).toContainText('arquivo original não foi alterado');

    await expect(playerBar).toContainText(editedTitle);
    await expect(playerBar).toContainText(editedArtist);

    const expectedFilteredCount = initialOverview.problems.unknownArtist - 1;
    await expect(healthFilter).toContainText(
      `${expectedFilteredCount.toLocaleString('pt-BR')} ${expectedFilteredCount === 1 ? 'faixa sinalizada' : 'faixas sinalizadas'}`
    );
    await expect(page.locator('.admin-metadata-row').filter({ hasText: track!.title })).toHaveCount(0);

    const effectiveResponse = await request.get('/api/library');
    expect(effectiveResponse.ok()).toBeTruthy();
    const effectiveLibrary = await effectiveResponse.json() as {
      tracks: Array<{ id: string; title: string; artist: string; album: string; albumArtist: string }>;
    };
    const effectiveTrack = effectiveLibrary.tracks.find(item => item.id === track!.id);
    expect(effectiveTrack?.title).toBe(editedTitle);
    expect(effectiveTrack?.artist).toBe(editedArtist);
    expect(effectiveTrack?.album).toBe(editedAlbum);
    expect(effectiveTrack?.albumArtist).toBe(editedArtist);

    const detailResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track!.id)}/metadata`);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json() as {
      physical: { title: string; artist: string; album: string };
      override: { title: string | null; artist: string | null; album: string | null };
      effective: { title: string; artist: string; album: string };
    };
    expect(detail.physical.title).toBe(track!.title);
    expect(detail.physical.artist).toBe(track!.artist);
    expect(detail.physical.album).toBe(track!.album);
    expect(detail.override.title).toBe(editedTitle);
    expect(detail.override.artist).toBe(editedArtist);
    expect(detail.override.album).toBe(editedAlbum);
    expect(detail.effective.title).toBe(editedTitle);

    const overviewAfterEditResponse = await request.get('/api/admin/library/overview');
    expect(overviewAfterEditResponse.ok()).toBeTruthy();
    const overviewAfterEdit = await overviewAfterEditResponse.json() as {
      problems: { unknownArtist: number; unknownAlbum: number };
    };
    expect(overviewAfterEdit.problems.unknownArtist).toBe(initialOverview.problems.unknownArtist - 1);
    expect(overviewAfterEdit.problems.unknownAlbum).toBe(initialOverview.problems.unknownAlbum - 1);

    const scanResponse = await request.post('/api/library/scan', { headers: mutationHeaders });
    expect(scanResponse.ok()).toBeTruthy();
    const afterScanResponse = await request.get('/api/library');
    expect(afterScanResponse.ok()).toBeTruthy();
    const afterScan = await afterScanResponse.json() as {
      tracks: Array<{ id: string; title: string; artist: string; album: string }>;
    };
    const afterScanTrack = afterScan.tracks.find(item => item.id === track!.id);
    expect(afterScanTrack?.title).toBe(editedTitle);
    expect(afterScanTrack?.artist).toBe(editedArtist);
    expect(afterScanTrack?.album).toBe(editedAlbum);

    page.once('dialog', confirmation => confirmation.accept());
    await editor.getByRole('button', { name: 'Restaurar texto', exact: true }).click();
    await expect(titleInput).toHaveValue(track!.title);
    await expect(editor.getByRole('status')).toContainText('voltou a exibir os metadados do arquivo');
    await expect(playerBar).toContainText(track!.title);
    await expect(playerBar).toContainText(track!.artist);
    await expect(healthFilter).toContainText(`${initialOverview.problems.unknownArtist.toLocaleString('pt-BR')} faixas sinalizadas`);
    await expect(page.locator('.admin-metadata-row').filter({ hasText: track!.title }).first()).toBeVisible();

    await page.locator('.admin-metadata-screen').getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(page.locator('#administration-title')).toHaveText('Administração');
    const restoredArtistAttention = page.locator('.administration-cockpit-attention__items button')
      .filter({ hasText: 'Artista desconhecido' });
    await expect(restoredArtistAttention.locator('strong')).toHaveText(initialOverview.problems.unknownArtist.toLocaleString('pt-BR'));

    const restoredResponse = await request.get('/api/library');
    expect(restoredResponse.ok()).toBeTruthy();
    const restored = await restoredResponse.json() as { tracks: LibraryTrack[] };
    const restoredTrack = restored.tracks.find(item => item.id === track!.id);
    expect(restoredTrack?.title).toBe(track!.title);
    expect(restoredTrack?.artist).toBe(track!.artist);
    expect(restoredTrack?.album).toBe(track!.album);
  } finally {
    if (trackId) {
      await request.delete(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
        headers: mutationHeaders
      }).catch(() => undefined);
    }
  }
});