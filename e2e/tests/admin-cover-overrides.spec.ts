import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

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

test('override de capa tem preview, não altera áudio e sobrevive a rescan', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  const request = page.context().request;
  const libraryResponse = await request.get('/api/library');
  expect(libraryResponse.ok()).toBeTruthy();
  const library = await libraryResponse.json() as {
    tracks: Array<{ id: string; title: string; hasCover: boolean; coverVersion?: string }>;
  };
  const track = library.tracks.find(item => item.title === 'E2E Track') ?? library.tracks[0];
  expect(track).toBeTruthy();

  await request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}/cover`, {
    headers: mutationHeaders
  }).catch(() => undefined);
  const initialStatusResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/cover`);
  expect(initialStatusResponse.ok()).toBeTruthy();
  const initialStatus = await initialStatusResponse.json() as { physicalHasCover: boolean };

  try {
    await openAdministration(page);
    await page.getByRole('button', { name: /^Metadados/ }).click();
    await expect(page.locator('#admin-metadata-title')).toHaveText('Metadados');

    const row = page.locator('.admin-metadata-row').filter({ hasText: track.title }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Editar', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Editar metadados' });
    await expect(dialog).toBeVisible();
    const coverInput = dialog.locator('input[type="file"]');
    await coverInput.setInputFiles({
      name: 'override.png',
      mimeType: 'image/png',
      buffer: PNG_1X1
    });

    await expect(dialog).toContainText('Preview local — a imagem ainda não foi enviada.');
    const preview = dialog.locator('.admin-cover-editor__preview img');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', /^blob:/);

    await dialog.getByRole('button', { name: 'Salvar capa', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('arquivo de áudio original não foi alterado');
    await expect(dialog).toContainText('Override ativo');

    const statusResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/cover`);
    expect(statusResponse.ok()).toBeTruthy();
    const status = await statusResponse.json() as {
      physicalHasCover: boolean;
      effectiveHasCover: boolean;
      override: { contentType: string; width: number; height: number; version: string } | null;
    };
    expect(status.physicalHasCover).toBe(initialStatus.physicalHasCover);
    expect(status.effectiveHasCover).toBe(true);
    expect(status.override).toMatchObject({ contentType: 'image/png', width: 1, height: 1 });
    expect(status.override?.version).toBeTruthy();

    const effectiveResponse = await request.get('/api/library');
    const effective = await effectiveResponse.json() as {
      tracks: Array<{ id: string; hasCover: boolean; coverVersion?: string }>;
    };
    const effectiveTrack = effective.tracks.find(item => item.id === track.id);
    expect(effectiveTrack?.hasCover).toBe(true);
    expect(effectiveTrack?.coverVersion).toBe(status.override?.version);

    const coverResponse = await request.get(
      `/api/tracks/${encodeURIComponent(track.id)}/cover?v=${encodeURIComponent(status.override!.version)}`
    );
    expect(coverResponse.ok()).toBeTruthy();
    expect(coverResponse.headers()['content-type']).toContain('image/png');
    expect(await coverResponse.body()).toEqual(PNG_1X1);

    const scanResponse = await request.post('/api/library/scan', { headers: mutationHeaders });
    expect(scanResponse.ok()).toBeTruthy();
    const afterScanStatus = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/cover`);
    expect((await afterScanStatus.json()).override.version).toBe(status.override?.version);

    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', { name: 'Restaurar capa do arquivo', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Override de capa removido');

    const restoredResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(track.id)}/cover`);
    const restored = await restoredResponse.json() as {
      physicalHasCover: boolean;
      effectiveHasCover: boolean;
      override: unknown;
    };
    expect(restored.override).toBeNull();
    expect(restored.physicalHasCover).toBe(initialStatus.physicalHasCover);
    expect(restored.effectiveHasCover).toBe(initialStatus.physicalHasCover);
  } finally {
    await request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}/cover`, {
      headers: mutationHeaders
    }).catch(() => undefined);
  }
});
