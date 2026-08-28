import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';

const items = [
  {
    id: 'scan-e2e',
    kind: 'scan',
    status: 'completed',
    label: 'Scan manual',
    createdAt: '2026-08-28T12:00:00.000Z',
    startedAt: '2026-08-28T12:00:00.000Z',
    finishedAt: '2026-08-28T12:00:03.250Z',
    durationMs: 3250,
    scanTrigger: 'manual',
    importSource: null,
    counts: {
      tracks: 42,
      added: 2,
      updated: 3,
      removed: 1,
      unchanged: 36
    },
    error: null,
    canRetry: false
  },
  {
    id: 'import-e2e',
    kind: 'import',
    status: 'failed',
    label: 'Importação por URL',
    createdAt: '2026-08-28T11:50:00.000Z',
    startedAt: '2026-08-28T11:50:01.000Z',
    finishedAt: '2026-08-28T11:50:06.000Z',
    durationMs: 5000,
    scanTrigger: null,
    importSource: { type: 'url', provider: null },
    counts: {
      tracks: null,
      added: null,
      updated: null,
      removed: null,
      unchanged: null
    },
    error: {
      message: 'A fonte não respondeu dentro do esperado.',
      action: 'Verifique a conectividade e a disponibilidade da fonte antes de tentar novamente.'
    },
    canRetry: false
  }
] as const;

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

test('admin filtra histórico e vê erro acionável sem dados sensíveis', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);

  const requestedUrls: string[] = [];
  await page.route('**/api/admin/operations**', async route => {
    const url = new URL(route.request().url());
    requestedUrls.push(url.toString());
    const kind = url.searchParams.get('kind');
    const status = url.searchParams.get('status');
    const filtered = items.filter(item => (
      (!kind || item.kind === kind)
      && (!status || item.status === status)
    ));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: filtered })
    });
  });

  await openAdministration(page);
  await page.getByRole('button', { name: /^Histórico operacional/ }).click();
  await expect(page.locator('#admin-operation-history-title')).toHaveText('Histórico operacional');

  const list = page.getByLabel('Operações recentes');
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list).toContainText('Scan manual');
  await expect(list).toContainText('Importação por URL');

  await list.getByRole('button', { name: /Importação por URL/ }).click();
  const detail = page.locator('.admin-operation-detail');
  await expect(detail).toContainText('A fonte não respondeu dentro do esperado.');
  await expect(detail).toContainText('O que fazer: Verifique a conectividade');
  await expect(detail).toContainText('Nova tentativa');
  await expect(detail).toContainText('Não disponível');
  await expect(detail).not.toContainText('token=');
  await expect(detail).not.toContainText('/srv/');

  await page.getByLabel('Tipo').selectOption('scan');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Scan manual');
  await expect(list).not.toContainText('Importação por URL');
  expect(requestedUrls.some(url => new URL(url).searchParams.get('kind') === 'scan')).toBe(true);

  await list.getByRole('button', { name: /Scan manual/ }).click();
  await expect(page.locator('.admin-operation-detail')).toContainText('42');
  await expect(page.locator('.admin-operation-detail')).toContainText('Adicionadas');
  await expect(page.locator('.admin-operation-detail')).toContainText('3,3 s');

  await page.getByLabel('Tipo').selectOption('');
  await expect(list.getByRole('button')).toHaveCount(2);
  await page.getByLabel('Status').selectOption('failed');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Importação por URL');
  expect(requestedUrls.some(url => new URL(url).searchParams.get('status') === 'failed')).toBe(true);
});
