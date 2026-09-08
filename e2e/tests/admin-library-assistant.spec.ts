import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };
const suggestionId = 'e2e-library-assistant-title';

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
  expect((await loginResponsePromise).ok()).toBeTruthy();
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

test.describe.configure({ retries: 0 });

test('Library Assistant revisa, aplica via override, atualiza player e sobrevive a rescan', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);
  const request = page.context().request;
  let trackId: string | undefined;

  try {
    await expect.poll(async () => {
      const response = await request.get('/api/admin/library-assistant/review?limit=500');
      if (!response.ok()) return false;
      const payload = await response.json() as { items: Array<{ suggestion: { id: string } }> };
      return payload.items.some(item => item.suggestion.id === suggestionId);
    }, { timeout: 20_000, message: 'a fixture offline do Assistente deve ficar disponível para revisão' }).toBe(true);

    const libraryResponse = await request.get('/api/library');
    expect(libraryResponse.ok()).toBeTruthy();
    const library = await libraryResponse.json() as { tracks: LibraryTrack[] };
    const track = library.tracks.find(item => item.title === 'E2E Track');
    expect(track, 'a fixture física E2E deve existir').toBeTruthy();
    trackId = track!.id;

    await playFixtureTrack(page, track!.title);
    const playerBar = page.getByTestId('desktop-player-bar');
    await expect(playerBar).toContainText('E2E Track');

    await openAdministration(page);
    await page.getByRole('button', { name: 'Assistente da Biblioteca', exact: true }).click();
    await expect(page.locator('#library-assistant-title')).toHaveText('Assistente da Biblioteca');
    await expect(page.locator('.assistant-admin__sections').getByRole('button', { name: 'Sugestões', exact: true })).toHaveClass(/is-active/);
    await expect(page.locator('.assistant-admin__info')).toContainText('A tela é atualizada automaticamente enquanto a análise estiver em andamento.');

    const row = page.locator('.assistant-admin-row').filter({ hasText: 'E2E Track' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Confiança alta');
    await expect(row).toContainText('E2E Track');
    await expect(row).toContainText('Título');
    await expect(row).toContainText('E2E Assistant Title');

    await row.locator('summary[aria-label="Ações para E2E Track"]').click();
    await row.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(page.locator('.assistant-admin__feedback')).toContainText('Sugestão aplicada');
    await expect(playerBar).toContainText('E2E Assistant Title');

    const effectiveResponse = await request.get('/api/library');
    expect(effectiveResponse.ok()).toBeTruthy();
    const effectiveLibrary = await effectiveResponse.json() as { tracks: LibraryTrack[] };
    expect(effectiveLibrary.tracks.find(item => item.id === trackId)?.title).toBe('E2E Assistant Title');

    const metadataResponse = await request.get(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`);
    expect(metadataResponse.ok()).toBeTruthy();
    const metadata = await metadataResponse.json() as {
      physical: { title: string };
      override: { title: string | null };
      effective: { title: string };
    };
    expect(metadata.physical.title).toBe('E2E Track');
    expect(metadata.override.title).toBe('E2E Assistant Title');
    expect(metadata.effective.title).toBe('E2E Assistant Title');

    const scanResponse = await request.post('/api/library/scan', { headers: mutationHeaders });
    expect(scanResponse.ok()).toBeTruthy();
    const afterScanResponse = await request.get('/api/library');
    expect(afterScanResponse.ok()).toBeTruthy();
    const afterScan = await afterScanResponse.json() as { tracks: LibraryTrack[] };
    expect(afterScan.tracks.find(item => item.id === trackId)?.title).toBe('E2E Assistant Title');

    const restoreResponse = await request.delete(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
      headers: mutationHeaders
    });
    expect(restoreResponse.ok()).toBeTruthy();
    const restoredResponse = await request.get('/api/library');
    expect(restoredResponse.ok()).toBeTruthy();
    const restored = await restoredResponse.json() as { tracks: LibraryTrack[] };
    expect(restored.tracks.find(item => item.id === trackId)?.title).toBe('E2E Track');
  } finally {
    if (trackId) {
      await request.delete(`/api/admin/tracks/${encodeURIComponent(trackId)}/metadata`, {
        headers: mutationHeaders
      }).catch(() => undefined);
    }
  }
});