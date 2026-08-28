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

test('override de metadata não altera arquivo e sobrevive a rescan', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  const request = page.context().request;
  const libraryResponse = await request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as { tracks: Array<{ id: string; title: string }> };
  const track = library.tracks.find(item => item.title === 'E2E Track') ?? library.tracks[0];
  expect(track).toBeTruthy();

  await request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}/metadata`, {
    headers: mutationHeaders
  }).catch(() => undefined);

  try {
    await openAdministration(page);
    await page.getByRole('button', { name: /^Metadados/ }).click();
    await expect(page.locator('#admin-metadata-title')).toHaveText('Metadados');

    const row = page.locator('.admin-metadata-row').filter({ hasText: track.title }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Editar', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Editar metadados' });
    await expect(dialog).toBeVisible();
    const titleInput = dialog.getByLabel('Título');
    await expect(titleInput).toHaveValue(track.title);
    await expect(dialog).toContainText(`Arquivo: ${track.title}`);

    const editedTitle = `E2E Track Override ${testInfo.retry}`;
    await titleInput.fill(editedTitle);
    await dialog.getByRole('button', { name: 'Salvar override', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('arquivo original não foi alterado');
    await expect(titleInput).toHaveValue(editedTitle);

    const effectiveResponse = await request.get('/api/library');
    expect(effectiveResponse.ok()).toBeTruthy();
    const effectiveLibrary = await effectiveResponse.json() as { tracks: Array<{ id: string; title: string }> };
    expect(effectiveLibrary.tracks.find(item => item.id === track.id)?.title).toBe(editedTitle);

    const detailResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/metadata`);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json() as {
      physical: { title: string };
      override: { title: string | null };
      effective: { title: string };
    };
    expect(detail.physical.title).toBe(track.title);
    expect(detail.override.title).toBe(editedTitle);
    expect(detail.effective.title).toBe(editedTitle);

    const scanResponse = await request.post('/api/library/scan', { headers: mutationHeaders });
    expect(scanResponse.ok()).toBeTruthy();
    const afterScanResponse = await request.get('/api/library');
    const afterScan = await afterScanResponse.json() as { tracks: Array<{ id: string; title: string }> };
    expect(afterScan.tracks.find(item => item.id === track.id)?.title).toBe(editedTitle);

    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', { name: 'Restaurar arquivo', exact: true }).click();
    await expect(titleInput).toHaveValue(track.title);
    await expect(dialog.getByRole('status')).toContainText('voltou a exibir os metadados do arquivo');

    const restoredResponse = await request.get('/api/library');
    const restored = await restoredResponse.json() as { tracks: Array<{ id: string; title: string }> };
    expect(restored.tracks.find(item => item.id === track.id)?.title).toBe(track.title);
  } finally {
    await request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}/metadata`, {
      headers: mutationHeaders
    }).catch(() => undefined);
  }
});
