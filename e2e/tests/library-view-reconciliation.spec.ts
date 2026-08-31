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

test('views distinguem erro inicial e preservam mutation confirmada quando a reconciliação falha', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  let getCount = 0;
  let created = false;
  await page.route('**/api/library-views', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      expect(request.headers()['x-home-music-request']).toBe('1');
      const payload = request.postDataJSON() as { name: string; definition: unknown };
      expect(payload.name).toBe('View E2E');
      created = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          view: {
            id: 'view-e2e',
            name: payload.name,
            definition: payload.definition,
            createdAt: '2026-08-31T14:00:00.000Z',
            updatedAt: '2026-08-31T14:00:00.000Z'
          }
        })
      });
      return;
    }

    if (request.method() !== 'GET') return route.fallback();
    getCount += 1;
    if (getCount === 2) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ views: [] }) });
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: getCount === 1 ? 'Views temporariamente indisponíveis' : 'Reconciliação temporariamente indisponível' })
    });
  });

  await login(page);
  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();

  const toggle = page.getByRole('button', { name: 'Ordenar, filtrar e gerenciar views' });
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('Views temporariamente indisponíveis');
  await expect(page.getByText('Salve a busca e os filtros atuais para reutilizar depois.', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(page.getByText('Salve a busca e os filtros atuais para reutilizar depois.', { exact: true })).toBeVisible();

  page.once('dialog', dialog => dialog.accept('View E2E'));
  await page.getByRole('button', { name: 'Salvar view', exact: true }).click();
  await expect.poll(() => created).toBe(true);
  await expect(page.getByText('View E2E', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Reconciliação temporariamente indisponível');
});
