import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
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

  await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  await expect(page.locator('main.app-shell')).toBeVisible();
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
  await expect(page.locator('main.app-shell')).toBeVisible();
}

async function openDesktopLibrary(page: Page) {
  await page.goto('/library');
  const table = page.getByTestId('desktop-library-table');
  await expect(table).toBeVisible();
  return table;
}

async function reloadOffline(context: BrowserContext, page: Page) {
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
}

test('downloads offline individual e em lote usam o fluxo desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);

  const table = await openDesktopLibrary(page);

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

  await table.getByRole('button', { name: 'Remover download offline de E2E Track' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remover download' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Remover download' }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(table.getByRole('button', { name: 'Baixar E2E Track para uso offline' })).toBeVisible();
});

test('reload sem rede entra direto nos downloads offline sem exibir login', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);
  const table = await openDesktopLibrary(page);

  await table.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  try {
    await reloadOffline(context, page);
    await expect(page.getByText('Downloads offline', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar E2E Track, Artista' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
    await expect(page.locator('form.login-form')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});

test('cold start em nova página sem rede abre os downloads pelo shell local', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);
  const table = await openDesktopLibrary(page);

  await table.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  await page.close();
  await context.setOffline(true);

  const coldStartPage = await context.newPage();
  try {
    await coldStartPage.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(coldStartPage.getByText('Downloads offline', { exact: true })).toBeVisible();
    await expect(coldStartPage.getByRole('button', { name: 'Tocar E2E Track, Artista' })).toBeVisible();
    await expect(coldStartPage.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
    await expect(coldStartPage.locator('form.login-form')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await coldStartPage.close();
  }
});

test('reload sem rede e sem downloads mostra indisponibilidade sem formulário de login', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);

  try {
    await reloadOffline(context, page);
    await expect(page.getByRole('heading', { name: 'Home Music indisponível' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
    await expect(page.locator('form.login-form')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});


test('backend inacessível com rede ativa preserva downloads e permite reconectar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);
  const table = await openDesktopLibrary(page);
  await table.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  await page.route('**/api/auth/status', route => route.abort('failed'));
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Downloads offline', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tocar E2E Track, Artista' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Entrar' })).toHaveCount(0);
  } finally {
    await page.unroute('**/api/auth/status');
  }

  await page.getByRole('button', { name: 'Tentar conectar ao servidor' }).click();
  await expect(page.locator('main.app-shell')).toBeVisible();
  const recoveredTable = await openDesktopLibrary(page);
  await expect(recoveredTable.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();
});



test('snapshot local permanece intacto enquanto autenticação online está pendente', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);
  await ensureServiceWorkerControl(page);
  const table = await openDesktopLibrary(page);
  await table.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  const before = await page.evaluate(() => {
    const owner = localStorage.getItem('home-music:offline-user-id:v1');
    if (!owner) throw new Error('Offline owner ausente');
    return { owner, manifest: localStorage.getItem(`home-music:offline-tracks:v2:${encodeURIComponent(owner)}`) };
  });
  expect(before.manifest).toContain('E2E Track');

  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/status', async route => {
    await blocked;
    try {
      await route.continue();
    } catch (error) {
      // Reload/service-worker navigation can cancel an intercepted request.
      // Only ignore that cancellation; other routing errors must still fail.
      if (!(error instanceof Error && /Route is already handled|Target page, context or browser has been closed/.test(error.message))) {
        throw error;
      }
    }
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Verificando sua sessão…')).toBeVisible();
    const during = await page.evaluate(owner => ({
      owner: localStorage.getItem('home-music:offline-user-id:v1'),
      manifest: localStorage.getItem(`home-music:offline-tracks:v2:${encodeURIComponent(owner)}`)
    }), before.owner);
    expect(during).toEqual(before);
  } finally {
    release();
    await page.unroute('**/api/auth/status');
  }
  await expect(page.locator('main.app-shell')).toBeVisible();
  const after = await openDesktopLibrary(page);
  await expect(after.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();
});

test('remoção offline usa diálogo com cancelamento, falha visível e retry', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page);
  await ensureServiceWorkerControl(page);
  const table = await openDesktopLibrary(page);
  await table.getByRole('button', { name: 'Baixar E2E Track para uso offline' }).click();
  await expect(table.getByRole('button', { name: 'Remover download offline de E2E Track' })).toBeVisible();

  try {
    await reloadOffline(context, page);
    const remove = page.getByRole('button', { name: 'Remover download individual de E2E Track' });
    await expect(remove).toBeVisible();
    await remove.focus();
    await remove.click();
    const dialog = page.getByRole('dialog', { name: 'Remover download individual?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('mantido se ainda for utilizado');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(remove).toBeFocused();

    await page.evaluate(() => {
      const storage = window.caches;
      const originalOpen = storage.open.bind(storage);
      let failOnce = true;
      storage.open = async name => {
        if (failOnce) {
          failOnce = false;
          throw new Error('Falha simulada do Cache Storage');
        }
        return originalOpen(name);
      };
    });
    await remove.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Remover' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Não foi possível remover');
    await expect(remove).toBeVisible();
    await dialog.getByRole('button', { name: 'Remover' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(remove).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});
