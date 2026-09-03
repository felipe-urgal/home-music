import { expect, test, type Page, type TestInfo } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

type LibraryTrack = { id: string; title: string };
type Playlist = { id: string; name: string; trackIds: string[] };

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);

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

async function ensureServiceWorkerControl(page: Page) {
  expect(await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  })).toBe(true);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
}

async function createCollection(page: Page, testInfo: TestInfo, count: 2) {
  const libraryResponse = await page.context().request.get('/api/library');
  expect(libraryResponse.ok()).toBe(true);
  const library = await libraryResponse.json() as { tracks: LibraryTrack[] };
  const tracks = ['E2E Track', 'E2E Zeta', 'E2E Zulu']
    .map(title => library.tracks.find(track => track.title === title))
    .filter((track): track is LibraryTrack => Boolean(track));
  expect(tracks).toHaveLength(3);

  const name = `E2E Offline ${testInfo.project.name} r${testInfo.retry} ${Date.now()}`;
  const createResponse = await page.context().request.post('/api/playlists', {
    headers: mutationHeaders,
    data: { name }
  });
  expect(createResponse.status()).toBe(201);

  const playlistsResponse = await page.context().request.get('/api/playlists');
  expect(playlistsResponse.ok()).toBe(true);
  const playlists = await playlistsResponse.json() as { playlists: Playlist[] };
  const playlist = playlists.playlists.find(item => item.name === name);
  expect(playlist).toBeTruthy();

  const selected = tracks.slice(0, count);
  const updateResponse = await page.context().request.put(`/api/playlists/${playlist!.id}/tracks`, {
    headers: mutationHeaders,
    data: { trackIds: selected.map(track => track.id) }
  });
  expect(updateResponse.ok()).toBe(true);

  return { playlist: { ...playlist!, trackIds: selected.map(track => track.id) }, tracks };
}

async function offlineStorageSnapshot(page: Page) {
  return page.evaluate(async () => {
    const userId = window.localStorage.getItem('home-music:offline-user-id:v1');
    if (!userId) throw new Error('Usuário offline não foi associado ao navegador.');
    const encoded = encodeURIComponent(userId);
    const manifest = JSON.parse(window.localStorage.getItem(`home-music:offline-tracks:v2:${encoded}`) ?? '[]') as Array<{ track: { id: string } }>;
    const references = JSON.parse(window.localStorage.getItem(`home-music:offline-references:v1:${encoded}`) ?? 'null') as {
      individualTrackIds: string[];
      collections: Array<{ kind: string; sourceId: string; trackIds: string[] }>;
    } | null;
    const cache = await caches.open(`home-music-offline-audio-v2-${encoded}`);
    return {
      physicalTrackIds: manifest.map(record => record.track.id).sort(),
      cacheEntries: (await cache.keys()).length,
      individualTrackIds: [...(references?.individualTrackIds ?? [])].sort(),
      collections: references?.collections ?? []
    };
  });
}

test('playlist offline deduplica bytes, promove referência individual e coleta somente faixas sem dono', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);
  const { playlist, tracks } = await createCollection(page, testInfo, 2);

  await page.goto('/library');
  const table = page.getByTestId('desktop-library-table');
  await expect(table).toBeVisible();
  await table.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  await page.goto(`/library/playlists/${encodeURIComponent(playlist.id)}`);
  await expect(page.getByText(playlist.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disponibilizar offline', exact: true }).click();
  await expect(page.getByText('2/2 · disponível offline', { exact: true })).toBeVisible();

  const playlistTable = page.getByTestId('desktop-library-table');
  const promoteZeta = playlistTable.getByRole('button', { name: 'Manter E2E Zeta também como download individual' });
  await expect(promoteZeta).toBeEnabled();
  await promoteZeta.click();
  await expect(playlistTable.getByRole('button', { name: 'Remover download individual de E2E Zeta; a coleção manterá a música offline' })).toBeVisible();

  await expect.poll(async () => {
    const snapshot = await offlineStorageSnapshot(page);
    return {
      physical: snapshot.physicalTrackIds.length,
      cache: snapshot.cacheEntries,
      individual: snapshot.individualTrackIds.length,
      collections: snapshot.collections.length
    };
  }).toEqual({ physical: 2, cache: 2, individual: 2, collections: 1 });

  const expandedTrackIds = tracks.map(track => track.id);
  const updateResponse = await page.context().request.put(`/api/playlists/${playlist.id}/tracks`, {
    headers: mutationHeaders,
    data: { trackIds: expandedTrackIds }
  });
  expect(updateResponse.ok()).toBe(true);

  await page.reload();
  await expect(page.getByText('conteúdo alterado', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar offline', exact: true }).click();
  await expect(page.getByText('3/3 · disponível offline', { exact: true })).toBeVisible();

  await expect.poll(async () => (await offlineStorageSnapshot(page)).physicalTrackIds.length).toBe(3);

  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: `Remover ${playlist.name} do modo offline` }).click();
  await expect(page.getByRole('button', { name: 'Disponibilizar offline', exact: true })).toBeVisible();

  await expect.poll(async () => {
    const snapshot = await offlineStorageSnapshot(page);
    return {
      physicalTrackIds: snapshot.physicalTrackIds,
      cacheEntries: snapshot.cacheEntries,
      individualTrackIds: snapshot.individualTrackIds,
      collectionCount: snapshot.collections.length
    };
  }).toEqual({
    physicalTrackIds: [tracks[0]!.id, tracks[1]!.id].sort(),
    cacheEntries: 2,
    individualTrackIds: [tracks[0]!.id, tracks[1]!.id].sort(),
    collectionCount: 0
  });
});

test('controle de coleção offline funciona no layout mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);
  const { playlist } = await createCollection(page, testInfo, 2);

  await page.goto(`/library/playlists/${encodeURIComponent(playlist.id)}`);
  await expect(page.getByText(playlist.name, { exact: true })).toBeVisible();
  const action = page.getByRole('button', { name: 'Disponibilizar offline', exact: true });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.getByText('2/2 · disponível offline', { exact: true })).toBeVisible();
});
