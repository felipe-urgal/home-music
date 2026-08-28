import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';
const TWO_MIB = 2 * 1024 * 1024;
const LIMIT_BYTES = 512 * 1024 * 1024;

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

test('admin visualiza armazenamento e limpa cache sem tocar no cache real do runner', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  let deleteSeen = false;
  await page.route('**/api/admin/transcoding/cache', async route => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      deleteSeen = true;
      expect(request.headers()['x-home-music-request']).toBe('1');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          freedBytes: TWO_MIB,
          removedEntries: 2,
          failedEntries: 0,
          cache: {
            bytes: 0,
            limitBytes: LIMIT_BYTES,
            entries: 0,
            temporaryEntries: 0,
            active: 0,
            pending: 0
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        bytes: TWO_MIB,
        limitBytes: LIMIT_BYTES,
        entries: 2,
        temporaryEntries: 0,
        active: 0,
        pending: 0
      })
    });
  });

  await openAdministration(page);
  const storage = page.locator('.administration-storage-card');
  await expect(storage).toBeVisible();
  await expect(storage).toContainText('Biblioteca física');
  await expect(storage).toContainText('Cache atual');
  await expect(storage).toContainText('2 MB');
  await expect(storage).toContainText('512 MB');
  await expect(storage).toContainText('Ocioso');

  page.once('dialog', dialog => dialog.accept());
  await storage.getByRole('button', { name: 'Limpar cache', exact: true }).click();

  await expect(storage.getByRole('status')).toContainText('2 MB liberados');
  await expect(storage.getByRole('status')).toContainText('Nenhuma música original foi alterada');
  await expect(storage).toContainText('0 B');
  expect(deleteSeen).toBe(true);
});
