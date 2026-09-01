import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function ensureServiceWorkerControl(page: Page) {
  const supported = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  expect(supported).toBe(true);

  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload();
  }

  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

test('downloads offline individual e em lote usam o fluxo desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);

  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();

  const table = page.getByTestId('desktop-library-table');
  await expect(table).toBeVisible();

  const individualDownload = table.getByRole('button', { name: 'Baixar E2E Track para uso offline' });
  await expect(individualDownload).toBeVisible();
  await individualDownload.click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  await table.getByRole('checkbox', { name: 'Selecionar E2E Zeta' }).check();
  await table.getByRole('checkbox', { name: 'Selecionar E2E Zulu' }).check();

  const bulkToolbar = page.getByTestId('desktop-bulk-toolbar');
  await expect(bulkToolbar).toContainText('2 selecionadas');
  const bulkDownload = bulkToolbar.getByRole('button', { name: 'Salvar 2 faixas selecionadas como downloads individuais' });
  await expect(bulkDownload).toBeEnabled();
  await bulkDownload.click();

  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Zeta' })).toBeVisible();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Zulu' })).toBeVisible();
  await expect(bulkToolbar.getByRole('button', { name: 'Todas as faixas selecionadas já possuem download individual disponível' })).toBeDisabled();

  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('E2E Track');
    await dialog.accept();
  });
  await table.getByRole('button', { name: 'Remover download offline de E2E Track' }).click();
  await expect(table.getByRole('button', { name: 'Baixar E2E Track para uso offline' })).toBeVisible();
});
