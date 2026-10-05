import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

type LibraryPayload = {
  tracks: Array<{ id: string; title: string }>;
};

type PlaybackStatePayload = {
  currentTrackId: string | null;
  queueIds: string[];
  updatedAt: string;
};

async function libraryTrackIds(page: Page) {
  const response = await page.context().request.get('/api/library');
  expect(response.ok()).toBeTruthy();
  const library = await response.json() as LibraryPayload;
  return new Map(library.tracks.map(track => [track.title, track.id]));
}

async function prepareQueueState(page: Page) {
  const loginResponse = await page.context().request.post('/api/auth/login', {
    headers: mutationHeaders,
    data: { username, password }
  });
  expect(loginResponse.ok()).toBeTruthy();

  const ids = await libraryTrackIds(page);
  const trackId = ids.get('E2E Track');
  const zetaId = ids.get('E2E Zeta');
  const zuluId = ids.get('E2E Zulu');
  expect(trackId).toBeTruthy();
  expect(zetaId).toBeTruthy();
  expect(zuluId).toBeTruthy();
  const orderedIds = [trackId!, zetaId!, zuluId!];

  const currentStateResponse = await page.context().request.get('/api/player/state');
  expect(currentStateResponse.ok()).toBeTruthy();
  const currentState = await currentStateResponse.json() as PlaybackStatePayload;

  const response = await page.context().request.put('/api/player/state', {
    headers: mutationHeaders,
    data: {
      currentTrackId: trackId,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueueIds: orderedIds,
      queueIds: orderedIds,
      updatedAt: currentState.updatedAt
    }
  });
  expect(response.ok()).toBeTruthy();

  await expect.poll(() => persistedQueueTitles(page), { timeout: 5_000 }).toEqual([
    'E2E Track',
    'E2E Zeta',
    'E2E Zulu'
  ]);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const hydratedStateResponse = await page.context().request.get('/api/player/state');
  expect(hydratedStateResponse.ok()).toBeTruthy();
  const hydratedState = await hydratedStateResponse.json() as PlaybackStatePayload;
  expect(hydratedState.currentTrackId).toBe(trackId);
  expect(hydratedState.queueIds).toEqual(orderedIds);

  const queue = page.getByTestId('desktop-queue');
  if (await queue.count()) {
    await expect(queue.locator('.desktop-queue__header')).toContainText('2');
    await expect(queue).toContainText('E2E Zeta');
    await expect(queue).toContainText('E2E Zulu');
  }
}

async function persistedQueueTitles(page: Page) {
  const [libraryResponse, stateResponse] = await Promise.all([
    page.context().request.get('/api/library'),
    page.context().request.get('/api/player/state')
  ]);
  expect(libraryResponse.ok()).toBeTruthy();
  expect(stateResponse.ok()).toBeTruthy();

  const library = await libraryResponse.json() as LibraryPayload;
  const state = await stateResponse.json() as PlaybackStatePayload;
  const titlesById = new Map(library.tracks.map(track => [track.id, track.title]));
  return state.queueIds.map(id => titlesById.get(id) ?? id);
}

test('reordenação da fila persiste no SQLite e sobrevive a reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await prepareQueueState(page);

  const queue = page.getByTestId('desktop-queue');
  const rows = queue.locator('.desktop-queue__row');
  await expect(rows).toHaveCount(2);

  const zetaRow = rows.filter({ hasText: 'E2E Zeta' });
  const zuluRow = rows.filter({ hasText: 'E2E Zulu' });
  const zetaHandle = zetaRow.locator('.desktop-queue__drag-handle');
  const zuluHandle = zuluRow.locator('.desktop-queue__drag-handle');
  await expect(zetaHandle).toBeVisible();
  await expect(zetaHandle).toHaveAttribute('aria-label', 'Arrastar E2E Zeta');
  await expect(zuluHandle).toBeVisible();
  await expect(zuluHandle).toHaveAttribute('aria-label', 'Arrastar E2E Zulu');

  await zuluHandle.dragTo(zetaRow);
  const reorderedRows = queue.locator('.desktop-queue__row');
  await expect(reorderedRows.nth(0)).toContainText('E2E Zulu');
  await expect(reorderedRows.nth(0).locator('.desktop-queue__drag-handle'))
    .toHaveAttribute('aria-label', 'Arrastar E2E Zulu');

  await expect.poll(() => persistedQueueTitles(page), { timeout: 5_000 }).toEqual([
    'E2E Track',
    'E2E Zulu',
    'E2E Zeta'
  ]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  const restoredRows = page.getByTestId('desktop-queue').locator('.desktop-queue__row');
  await expect(restoredRows).toHaveCount(2);
  await expect(restoredRows.nth(0)).toContainText('E2E Zulu');
  await expect(restoredRows.nth(0).locator('.desktop-queue__drag-handle'))
    .toHaveAttribute('aria-label', 'Arrastar E2E Zulu');
  await expect(restoredRows.nth(1)).toContainText('E2E Zeta');
  await expect(restoredRows.nth(1).locator('.desktop-queue__drag-handle'))
    .toHaveAttribute('aria-label', 'Arrastar E2E Zeta');
});


test('fila não deixa próxima faixa atravessar a atual e permanece aberta ao avançar', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-chromium'].includes(testInfo.project.name));

  if (testInfo.project.name === 'desktop-chromium') {
    await prepareQueueState(page);
    const queue = page.getByTestId('desktop-queue');
    const zetaRow = queue.locator('.desktop-queue__row').filter({ hasText: 'E2E Zeta' });
    const zetaMenuTrigger = zetaRow.locator('.desktop-queue__more-trigger');
    await expect(zetaMenuTrigger).toBeVisible();
    await expect(zetaMenuTrigger).toHaveAttribute('aria-label', 'Mais opções para E2E Zeta');
    await zetaMenuTrigger.click();
    const zetaMenu = queue.getByRole('menu', { name: 'Opções de E2E Zeta' });
    await expect(zetaMenu.getByRole('menuitem', { name: 'Mover para cima' })).toBeDisabled();

    await expect.poll(() => persistedQueueTitles(page)).toEqual([
      'E2E Track',
      'E2E Zeta',
      'E2E Zulu'
    ]);
    return;
  }

  await prepareQueueState(page);

  const openQueue = page.getByRole('button', { name: /Abrir fila/ });
  await openQueue.click();
  const queueDialog = page.getByRole('dialog', { name: 'Fila de reprodução' });
  await expect(queueDialog).toBeVisible();
  await expect(queueDialog.getByRole('button', { name: 'Mover E2E Zeta para cima' })).toBeDisabled();

  const zetaTrack = queueDialog.getByRole('button').filter({ hasText: 'E2E Zeta' });
  await zetaTrack.click();
  await expect(page.getByRole('heading', { name: 'E2E Zeta' })).toBeVisible();
  await expect(queueDialog).toBeVisible();
});
