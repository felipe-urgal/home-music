import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

type LibraryPayload = {
  tracks: Array<{ id: string; title: string }>;
};

type PlaybackStatePayload = {
  queueIds: string[];
  updatedAt: string;
};

async function libraryTrackIds(page: Page) {
  const response = await page.context().request.get('/api/library');
  expect(response.ok()).toBeTruthy();
  const library = await response.json() as LibraryPayload;
  return new Map(library.tracks.map(track => [track.title, track.id]));
}

async function loginAndResetQueueState(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  await expect(page.locator('.desktop-layout')).toBeVisible();

  // Encerra a instância viva antes do reset para que pagehide/heartbeat não
  // disputem com o estado determinístico usado por este cenário.
  await page.goto('about:blank');

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

  await loginAndResetQueueState(page);

  const queue = page.getByTestId('desktop-queue');
  const handles = queue.getByRole('button', { name: /^Arrastar E2E / });
  await expect(handles.nth(0)).toHaveAccessibleName('Arrastar E2E Zeta');
  await expect(handles.nth(1)).toHaveAccessibleName('Arrastar E2E Zulu');

  const zuluHandle = queue.getByRole('button', { name: 'Arrastar E2E Zulu' });
  await zuluHandle.dragTo(queue.getByText('E2E Zeta', { exact: true }));
  await expect(handles.nth(0)).toHaveAccessibleName('Arrastar E2E Zulu');

  await expect.poll(() => persistedQueueTitles(page), { timeout: 5_000 }).toEqual([
    'E2E Track',
    'E2E Zulu',
    'E2E Zeta'
  ]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  const restoredHandles = page.getByTestId('desktop-queue').getByRole('button', { name: /^Arrastar E2E / });
  await expect(restoredHandles.nth(0)).toHaveAccessibleName('Arrastar E2E Zulu');
  await expect(restoredHandles.nth(1)).toHaveAccessibleName('Arrastar E2E Zeta');
});


test('fila não deixa próxima faixa atravessar a atual e permanece aberta ao avançar', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-chromium'].includes(testInfo.project.name));

  await loginAndResetQueueState(page);

  if (testInfo.project.name === 'desktop-chromium') {
    const queue = page.getByTestId('desktop-queue');
    const zetaMenuTrigger = queue.getByRole('button', { name: 'Mais opções para E2E Zeta' });
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
