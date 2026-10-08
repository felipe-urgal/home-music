import { expect, request, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const chromeLinux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openAccount(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024) {
    await page.getByTestId('desktop-sidebar').getByRole('button', { name: /Minha conta/ }).click();
  } else if (width < 700) {
    await page.getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Conta', exact: true }).click();
  } else {
    const back = page.getByRole('button', { name: 'Voltar à biblioteca', exact: true });
    if (await back.isVisible()) await back.click();
    await page.getByRole('button', { name: /Minha conta ·/ }).click();
  }
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
}

async function createSecondarySession(userAgent: string) {
  const client = await request.newContext({
    baseURL: 'http://127.0.0.1:8791',
    extraHTTPHeaders: { 'User-Agent': userAgent, 'X-Home-Music-Request': '1' }
  });
  try {
    const response = await client.post('/api/auth/login', { data: { username, password } });
    expect(response.ok()).toBeTruthy();
  } finally {
    await client.dispose();
  }
}

function otherSessionCard(page: Page) {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  return page.locator(desktop
    ? '.account-sessions-v2__card:not(.is-current)'
    : '.account-session-card:not(.is-current)').first();
}

async function requestRevokeOne(page: Page) {
  const card = otherSessionCard(page);
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await card.getByRole('button', { name: /^Opções de/ }).click();
    await card.getByRole('menuitem', { name: 'Encerrar sessão' }).click();
  } else {
    await card.getByRole('button', { name: 'Encerrar esta sessão' }).click();
  }
  return page.getByRole('dialog');
}

test('Minha Conta preserva navegação e confirmações de sessão em desktop e mobile', async ({ page }) => {
  const nativeDialogs: string[] = [];
  page.on('dialog', async dialog => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });

  await login(page);
  const reset = await page.context().request.post('/api/auth/sessions/revoke-others', {
    headers: { 'X-Home-Music-Request': '1' }
  });
  expect(reset.ok()).toBeTruthy();
  await createSecondarySession(chromeLinux);
  await createSecondarySession('identificador-opaco-sem-plataforma');

  await openAccount(page);
  await page.getByRole('button', { name: /Outros dispositivos/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Outros dispositivos');
  await expect(page.getByText('Este dispositivo', { exact: true })).toBeVisible();
  await expect(page.getByText('Chrome · Linux', { exact: true })).toBeVisible();
  await expect(page.getByText('Dispositivo não identificado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Última atividade/).first()).toBeVisible();

  const dialog = await requestRevokeOne(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Encerrar sessão' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(otherSessionCard(page)).toBeVisible();

  const reopened = await requestRevokeOne(page);
  await reopened.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(reopened).not.toBeVisible();
  await expect(page.locator('.account-sessions-v2__card:not(.is-current), .account-session-card:not(.is-current)')).toHaveCount(1);

  await page.getByRole('button', { name: 'Encerrar todas as outras sessões', exact: true }).click();
  const allDialog = page.getByRole('dialog');
  await expect(allDialog).toBeVisible();
  await allDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(otherSessionCard(page)).toBeVisible();

  await page.getByRole('button', { name: 'Encerrar todas as outras sessões', exact: true }).click();
  await allDialog.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(allDialog).not.toBeVisible();
  await expect(page.locator('.account-sessions-v2__card:not(.is-current), .account-session-card:not(.is-current)')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /sessão foi encerrada/ })).toBeVisible();

  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  expect(nativeDialogs).toEqual([]);
});

test('erro da troca de senha mantém confirmação aberta e cancelar devolve o foco', async ({ page }) => {
  await login(page);
  await openAccount(page);
  await page.getByRole('button', { name: /Alterar senha/ }).first().click();
  await expect(page.locator('#my-account-title')).toHaveText('Alterar senha');
  await page.getByLabel('Senha atual').fill('senha-atual-incorreta');
  await page.getByLabel('Nova senha', { exact: true }).fill('abc123');
  await page.getByLabel('Confirmar nova senha').fill('abc123');

  const trigger = page.getByRole('button', { name: /^(Alterar senha|Alterar senha e sair)$/ }).last();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole('button', { name: 'Alterar senha e sair' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Senha atual inválida.');
  await expect(dialog.getByRole('button', { name: 'Alterar senha e sair' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
});

test('erro ao revogar sessões continua no diálogo até o usuário decidir', async ({ page }) => {
  await login(page);
  const reset = await page.context().request.post('/api/auth/sessions/revoke-others', {
    headers: { 'X-Home-Music-Request': '1' }
  });
  expect(reset.ok()).toBeTruthy();
  await createSecondarySession(chromeLinux);
  await openAccount(page);
  await page.getByRole('button', { name: /Outros dispositivos/ }).click();

  await page.route('**/api/auth/sessions/revoke-others', async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Erro de teste ao revogar' }) });
  });

  await page.getByRole('button', { name: 'Encerrar todas as outras sessões', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Erro de teste ao revogar');
  await expect(otherSessionCard(page)).toBeVisible();
  await page.unroute('**/api/auth/sessions/revoke-others');
  await dialog.getByRole('button', { name: 'Encerrar sessão' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.account-sessions-v2__card:not(.is-current), .account-session-card:not(.is-current)')).toHaveCount(0);
});
