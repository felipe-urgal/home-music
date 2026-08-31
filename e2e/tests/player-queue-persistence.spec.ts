import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

type LibraryPayload = {
  tracks: Array<{ id: string; title: string }>;
};

type PlaybackStatePayload = {
  queueIds: string[];
};

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
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

  await login(page);

  const queue = page.getByTestId('desktop-queue');
  const zuluHandle = queue.getByRole('button', { name: 'Arrastar E2E Zulu' });
  const zetaRow = queue.locator('.desktop-queue__row').filter({ hasText: 'E2E Zeta' });
  await expect(zuluHandle).toBeVisible();
  await expect(zetaRow).toBeVisible();

  await zuluHandle.dragTo(zetaRow);
  await expect(queue.locator('.desktop-queue__row').nth(0)).toContainText('E2E Zulu');

  await expect.poll(() => persistedQueueTitles(page), { timeout: 5_000 }).toEqual([
    'E2E Track',
    'E2E Zulu',
    'E2E Zeta'
  ]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  const restoredQueue = page.getByTestId('desktop-queue');
  await expect(restoredQueue.locator('.desktop-queue__row').nth(0)).toContainText('E2E Zulu');
  await expect(restoredQueue.locator('.desktop-queue__row').nth(1)).toContainText('E2E Zeta');
});
