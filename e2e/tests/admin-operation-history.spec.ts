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
    canRetry: true,
    importRetry: {
      attempt: 1,
      parentOperationId: null,
      rootOperationId: 'import-e2e',
      failureDisposition: 'retryable'
    }
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
  await page.getByRole('button', { name: 'Expandir barra superior' }).click();
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

  let retryBody: unknown = null;
  await page.route('**/api/admin/operations/import-e2e/retry', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-home-music-request']).toBe('1');
    retryBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ job: { id: 'retry-e2e', status: 'pending' } })
    });
  });

  await openAdministration(page);
  await page.getByRole('button', { name: /^Histórico\b/ }).click();
  await expect(page.locator('#admin-operation-history-title')).toHaveText('Histórico operacional');

  const list = page.getByLabel('Operações recentes');
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list).toContainText('Scan manual');
  await expect(list).toContainText('Importação por URL');

  await list.getByRole('button', { name: /Importação por URL/ }).click();
  const detail = page.locator('.admin-operation-detail');
  await expect(detail).toContainText('A fonte não respondeu dentro do esperado.');
  const errorDetails = detail.locator('.admin-operation-detail__error');
  await expect(errorDetails).toContainText('O que fazer');
  await expect(errorDetails).toContainText('Verifique a conectividade');
  await expect(detail).toContainText('Nova tentativa');
  await expect(detail).toContainText('Disponível');

  const retryUrl = 'https://fixtures.invalid/retry-e2e.wav';
  await detail.getByLabel('URL', { exact: true }).fill(retryUrl);
  await detail.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(detail.locator('.admin-operation-detail__retry-message')).toContainText('Tentativa #2 criada');
  expect(retryBody).toEqual({ url: retryUrl });
  await expect(detail.getByRole('button', { name: 'Continuar em Importar mídia' })).toBeVisible();
  await expect(detail).not.toContainText('token=');
  await expect(detail).not.toContainText('/srv/');

  await page.getByRole('navigation', { name: 'Tipo' }).getByRole('button', { name: 'Scans', exact: true }).click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Scan manual');
  await expect(list).not.toContainText('Importação por URL');
  expect(requestedUrls.some(url => new URL(url).searchParams.get('kind') === 'scan')).toBe(true);

  await list.getByRole('button', { name: /Scan manual/ }).click();
  await expect(page.locator('.admin-operation-detail')).toContainText('42');
  await expect(page.locator('.admin-operation-detail')).toContainText('Adicionadas');
  await expect(page.locator('.admin-operation-detail')).toContainText('3,3 s');

  await page.getByRole('navigation', { name: 'Tipo' }).getByRole('button', { name: 'Todos', exact: true }).click();
  await expect(list.getByRole('button')).toHaveCount(2);
  await page.getByLabel('Status').selectOption('failed');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Importação por URL');
  expect(requestedUrls.some(url => new URL(url).searchParams.get('status') === 'failed')).toBe(true);
});
