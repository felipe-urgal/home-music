import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = {
  'Content-Type': 'application/json',
  'X-Home-Music-Request': '1'
};

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

test('organização física preserva id, streaming e rescan e permite restaurar caminho', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  const request = page.context().request;
  const libraryResponse = await request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as {
    tracks: Array<{ id: string; title: string; folderPath: string }>;
  };
  const track = library.tracks.find(item => item.title === 'E2E Track') ?? library.tracks[0];
  expect(track).toBeTruthy();

  const initialLocationResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/location`);
  expect(initialLocationResponse.ok()).toBeTruthy();
  const initialLocation = await initialLocationResponse.json() as {
    folderPath: string;
    fileName: string;
    relativePath: string;
  };
  const temporaryFolder = 'E2E Move Temp';
  let moved = false;

  try {
    await openAdministration(page);
    await page.getByRole('button', { name: /^Gerenciar músicas/ }).click();
    await expect(page.locator('#admin-tracks-title')).toHaveText('Gerenciar músicas');

    const search = page.getByLabel('Buscar músicas');
    await search.fill(track.title);
    const row = page.locator('.admin-track-row').filter({ hasText: track.title }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Organizar', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Organizar arquivo' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(initialLocation.relativePath);
    await dialog.getByLabel('Pasta dentro de MUSIC_DIR').fill(temporaryFolder);
    await expect(dialog).toContainText(`${temporaryFolder}/${initialLocation.fileName}`);
    await dialog.getByRole('button', { name: 'Mover arquivo', exact: true }).click();
    await expect(dialog).toBeHidden();
    moved = true;

    await expect(page.getByRole('status')).toContainText(`arquivo movido para “${temporaryFolder}/${initialLocation.fileName}”`);

    const movedLocationResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/location`);
    expect(movedLocationResponse.ok()).toBeTruthy();
    const movedLocation = await movedLocationResponse.json() as { relativePath: string; folderPath: string };
    expect(movedLocation.relativePath).toBe(`${temporaryFolder}/${initialLocation.fileName}`);
    expect(movedLocation.folderPath).toBe(temporaryFolder);

    const effectiveLibrary = await (await request.get('/api/library')).json() as {
      tracks: Array<{ id: string; folderPath: string }>;
    };
    expect(effectiveLibrary.tracks.find(item => item.id === track.id)?.folderPath).toBe(temporaryFolder);

    const stream = await request.get(`/api/tracks/${encodeURIComponent(track.id)}/stream`, {
      headers: { Range: 'bytes=0-0' }
    });
    expect([200, 206]).toContain(stream.status());

    const scan = await request.post('/api/library/scan', {
      headers: { 'X-Home-Music-Request': '1' }
    });
    expect(scan.ok()).toBeTruthy();
    const afterScan = await (await request.get('/api/library')).json() as {
      tracks: Array<{ id: string; folderPath: string }>;
    };
    expect(afterScan.tracks.find(item => item.id === track.id)?.folderPath).toBe(temporaryFolder);
  } finally {
    if (moved) {
      const restored = await request.post(`/api/admin/tracks/${encodeURIComponent(track.id)}/move`, {
        headers: mutationHeaders,
        data: {
          folderPath: initialLocation.folderPath,
          fileName: initialLocation.fileName
        }
      });
      expect(restored.ok()).toBeTruthy();
      const restoredLocation = await (await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/location`)).json() as {
        relativePath: string;
      };
      expect(restoredLocation.relativePath).toBe(initialLocation.relativePath);
    }
  }
});
