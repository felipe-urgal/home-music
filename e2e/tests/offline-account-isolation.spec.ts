import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const mutationHeaders = { 'X-Home-Music-Request': '1' };

async function submitLogin(page: Page, username: string, password: string) {
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
}

async function login(page: Page, username: string, password: string) {
  await submitLogin(page, username, password);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  await expect(page.locator('main.app-shell')).toBeVisible();
}

async function resetSession(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
}

async function ensureServiceWorker(page: Page) {
  expect(await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  })).toBe(true);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
}

async function libraryTable(page: Page) {
  await page.getByTestId('desktop-sidebar').getByRole('button', { name: 'Pastas', exact: true }).click();
  const table = page.getByTestId('desktop-library-table');
  await expect(table).toBeVisible();
  return table;
}

async function offlineReferenceSnapshot(page: Page) {
  return page.evaluate(() => {
    const userId = window.localStorage.getItem('home-music:offline-user-id:v1');
    if (!userId) throw new Error('Usuário offline não foi associado ao navegador.');
    const key = `home-music:offline-references:v1:${encodeURIComponent(userId)}`;
    const manifest = JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
      individualTrackIds?: string[];
      collections?: unknown[];
    } | null;
    return {
      userId,
      key,
      individualTrackIds: manifest?.individualTrackIds ?? [],
      collectionCount: manifest?.collections?.length ?? 0
    };
  });
}

test('CacheStorage e referências offline não vazam entre contas no mesmo navegador', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, adminUsername, adminPassword);
  await ensureServiceWorker(page);
  const adminTable = await libraryTable(page);
  await adminTable.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(adminTable.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();
  const adminReferences = await offlineReferenceSnapshot(page);
  expect(adminReferences.individualTrackIds).toHaveLength(1);

  const userName = `offline-r${testInfo.retry}`;
  const createResponse = await page.context().request.post('/api/admin/users', {
    headers: mutationHeaders,
    data: { username: userName, role: 'user' }
  });
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as { temporaryPassword: string };

  await resetSession(page);
  await submitLogin(page, userName, created.temporaryPassword);
  await expect(page.getByRole('heading', { name: 'Defina uma nova senha' })).toBeVisible();
  const userPassword = `Offline-r${testInfo.retry}-password-2026`;
  await page.getByLabel('Senha temporária', { exact: true }).fill(created.temporaryPassword);
  await page.getByLabel('Nova senha', { exact: true }).fill(userPassword);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(userPassword);
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  await login(page, userName, userPassword);
  await ensureServiceWorker(page);
  const userTable = await libraryTable(page);
  await expect(userTable.getByRole('button', { name: 'Baixar E2E Track para uso offline' })).toBeVisible();
  await expect(userTable.getByRole('button', { name: 'Remover download offline de E2E Track' })).toHaveCount(0);
  const userReferences = await offlineReferenceSnapshot(page);
  expect(userReferences.userId).not.toBe(adminReferences.userId);
  expect(userReferences.key).not.toBe(adminReferences.key);
  expect(userReferences.individualTrackIds).toEqual([]);
  expect(userReferences.collectionCount).toBe(0);

  await resetSession(page);
  await login(page, adminUsername, adminPassword);
  await ensureServiceWorker(page);
  const restoredAdminTable = await libraryTable(page);
  await expect(restoredAdminTable.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();
  const restoredAdminReferences = await offlineReferenceSnapshot(page);
  expect(restoredAdminReferences).toEqual(adminReferences);
});
