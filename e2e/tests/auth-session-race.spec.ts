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
  // A rota canônica /account funciona em desktop, tablet e mobile, mesmo
  // quando o login abre diretamente a tela de reprodução.
  await page.goto('/account');
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
  await page.getByRole('button', { name: /Sair da conta/ }).first().click();
  await expect(page.getByText('Serviço temporariamente indisponível.')).toBeVisible();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await expect(page.getByRole('button', { name: /Sair da conta/ }).first()).toBeEnabled();
});

test('logout ignora AUTH_REQUIRED_EVENT de uma resposta HTTP 401 concorrente', async ({ page }) => {
  await login(page);
  await openAccount(page);
  let releaseLogout!: () => void;
  let markStarted!: () => void;
  const proceed = new Promise<void>(resolve => { releaseLogout = resolve; });
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  await page.route('**/api/auth/logout', async route => {
    markStarted();
    await proceed;
    await route.continue();
  });
  // A consulta de sessões passa pelo apiFetch, que deve emitir AUTH_REQUIRED_EVENT
  // ao receber um 401 real, em vez de o teste disparar o evento manualmente.
  await page.route('**/api/auth/sessions', async route => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Sessão expirada.' })
    });
  });
  await page.evaluate(() => {
    window.addEventListener('home-music:auth-required', () => {
      document.body.setAttribute('data-auth-required-from-401', 'yes');
    }, { once: true });
  });

  await page.getByRole('button', { name: /Sair da conta/ }).first().click();
  await started;
  const unauthorized = page.waitForResponse(response =>
    response.url().endsWith('/api/auth/sessions') && response.status() === 401
  );
  await page.getByRole('button', { name: /Outros dispositivos/ }).click();
  await unauthorized;
  await expect(page.locator('body')).toHaveAttribute('data-auth-required-from-401', 'yes');
  // A sessão visual não é apagada enquanto o logout confirmado não terminar.
  await expect(page.locator('#my-account-title')).toHaveText('Outros dispositivos');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);

  releaseLogout();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('#my-account-title')).toHaveCount(0);
});

test('sessão revogada em outra aba é removida após revalidar', async ({ page }) => {
  await login(page);
  const loggedOut = await page.context().request.post('/api/auth/logout', {
    headers: { 'X-Home-Music-Request': '1' }
  });
  expect(loggedOut.status()).toBe(204);

  await page.evaluate(() => window.dispatchEvent(new Event('home-music:auth-required')));
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  const offlineUserId = await page.evaluate(() => localStorage.getItem('home-music:offline-user-id:v1'));
  expect(offlineUserId).toBeNull();
});
