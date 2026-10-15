import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openAccount(page: Page) {
  const width = page.viewportSize()?.width || 0;
  if (width >= 1024) {
    const expand = page.getByRole('button', { name: 'Expandir barra superior' });
    if (await expand.isVisible().catch(() => false)) await expand.click();
    await page.getByTestId('desktop-sidebar').getByRole('button', { name: /Minha conta/ }).click();
  } else if (width < 700) {
    await page.getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Conta', exact: true }).click();
  } else {
    await page.getByRole('button', { name: /Minha conta ·/ }).click();
  }
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
}

test('há um único bootstrap de status e 401 tardio revalida a sessão atual', async ({ page }) => {
  let statusRequests = 0;
  await page.route('**/api/auth/status', async route => {
    statusRequests += 1;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  expect(statusRequests).toBe(1);

  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const before = statusRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('home-music:auth-required')));
  await expect.poll(() => statusRequests).toBe(before + 1);
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
});

test('429 expõe Retry-After sem distinguir identidade e bloqueia submit em andamento', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/auth/login', async route => {
    attempts += 1;
    await route.fulfill({
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': '3' },
      body: JSON.stringify({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' })
    });
  });
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill('senha-incorreta');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Aguarde 3 segundos');
  expect(attempts).toBe(1);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('falha HTTP no logout mantém a sessão e permite tentar novamente', async ({ page }) => {
  await login(page);
  await openAccount(page);
  await page.route('**/api/auth/logout', async route => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Serviço temporariamente indisponível.' })
    });
  });
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).first().click();
  await expect(page.getByText('Serviço temporariamente indisponível.')).toBeVisible();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await expect(page.getByRole('button', { name: 'Sair da conta', exact: true }).first()).toBeEnabled();
});
