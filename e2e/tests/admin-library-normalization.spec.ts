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

test('admin revisa alias lógico, biblioteca e smart playlist usam projeção canônica e undo restaura grafia', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  const request = page.context().request;
  const initialResponse = await request.get('/api/library');
  expect(initialResponse.ok()).toBeTruthy();
  const initial = await initialResponse.json() as { tracks: Array<{ id: string; title: string; artist: string }> };
  expect(initial.tracks.length).toBeGreaterThanOrEqual(2);
  const sourceTrack = initial.tracks[0];
  const canonicalTrack = initial.tracks[1];

  async function clearAliases() {
    const response = await request.get('/api/admin/library/normalization');
    if (!response.ok()) return;
    const review = await response.json() as { aliases: Array<{ id: string }> };
    for (const alias of review.aliases) {
      await request.delete(`/api/admin/library/normalization/aliases/${encodeURIComponent(alias.id)}`, {
        headers: mutationHeaders
      }).catch(() => undefined);
    }
  }

  await clearAliases();
  for (const track of [sourceTrack, canonicalTrack]) {
    await request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}/metadata`, {
      headers: mutationHeaders
    }).catch(() => undefined);
  }

  try {
    const sourceOverride = await request.patch(`/api/admin/tracks/${encodeURIComponent(sourceTrack.id)}/metadata`, {
      headers: { ...mutationHeaders, 'Content-Type': 'application/json' },
      data: {
        artist: 'Beyonce',
        albumArtist: 'Beyonce',
        album: 'Lemonade'
      }
    });
    expect(sourceOverride.ok()).toBeTruthy();

    const canonicalOverride = await request.patch(`/api/admin/tracks/${encodeURIComponent(canonicalTrack.id)}/metadata`, {
      headers: { ...mutationHeaders, 'Content-Type': 'application/json' },
      data: {
        artist: 'Beyoncé',
        albumArtist: 'Beyoncé',
        album: 'Lémonade'
      }
    });
    expect(canonicalOverride.ok()).toBeTruthy();

    await openAdministration(page);
    await page.getByRole('button', { name: /^Normalização/ }).click();
    await expect(page.locator('#admin-normalization-title')).toHaveText('Normalização lógica');
    await expect(page.getByText('Nenhum arquivo é renomeado')).toBeVisible();

    const artistCandidate = page.locator('.admin-normalization__candidate')
      .filter({ hasText: 'Beyonce' })
      .filter({ hasText: 'Beyoncé' })
      .first();
    await expect(artistCandidate).toBeVisible();
    await artistCandidate.getByRole('radio', { name: /Beyoncé/ }).check();
    await artistCandidate.getByRole('button', { name: 'Associar variações' }).click();
    await expect(page.getByRole('status')).toContainText('Variações associadas a “Beyoncé”');

    const canonicalLibraryResponse = await request.get('/api/library');
    expect(canonicalLibraryResponse.ok()).toBeTruthy();
    const canonicalLibrary = await canonicalLibraryResponse.json() as {
      tracks: Array<{ id: string; artist: string }>;
    };
    expect(canonicalLibrary.tracks.find(track => track.id === sourceTrack.id)?.artist).toBe('Beyoncé');
    expect(canonicalLibrary.tracks.find(track => track.id === canonicalTrack.id)?.artist).toBe('Beyoncé');

    const preview = await request.post('/api/smart-playlists/preview', {
      headers: { ...mutationHeaders, 'Content-Type': 'application/json' },
      data: {
        rule: {
          artist: 'Beyoncé',
          album: null,
          folderPath: null,
          favorite: null,
          history: 'any',
          periodDays: null,
          sort: 'title',
          limit: 100
        }
      }
    });
    expect(preview.ok()).toBeTruthy();
    const previewPayload = await preview.json() as { trackIds: string[] };
    expect(previewPayload.trackIds).toEqual(expect.arrayContaining([sourceTrack.id, canonicalTrack.id]));

    const aliasRow = page.locator('.admin-normalization__aliases article')
      .filter({ hasText: 'Beyonce → Beyoncé' })
      .first();
    await expect(aliasRow).toBeVisible();
    await aliasRow.getByRole('button', { name: /Desfazer associação/ }).click();
    await expect(page.getByRole('status')).toContainText('Associação “Beyonce → Beyoncé” desfeita');

    const restoredResponse = await request.get('/api/library');
    const restored = await restoredResponse.json() as { tracks: Array<{ id: string; artist: string }> };
    expect(restored.tracks.find(track => track.id === sourceTrack.id)?.artist).toBe('Beyonce');
  } finally {
    await clearAliases();
    for (const track of [sourceTrack, canonicalTrack]) {
      await request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}/metadata`, {
        headers: mutationHeaders
      }).catch(() => undefined);
    }
  }
});
