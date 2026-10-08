import { expect, test, type Page } from '@playwright/test';

async function openUsers(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill('playwright');
  await page.getByLabel('Senha', { exact: true }).fill('playwright-password-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  await page.getByRole('button', { name: 'Expandir barra superior' }).click();
  await page.getByTestId('desktop-sidebar').getByRole('button', { name: /Minha conta/ }).click();
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await page.getByRole('button', { name: /^Usuários/ }).click();
  await expect(page.locator('#admin-users-title')).toHaveText('Usuários');
}

test('senha temporária exige confirmação acessível e mantém segredo no cancelamento', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  const nativeDialogs: string[] = [];
  page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  await openUsers(page);
  const username = 'e2e-descartar-659';
  let createdId: string | null = null;
  try {
    await page.getByRole('button', { name: 'Novo usuário' }).click();
    await page.getByLabel('Nome de usuário').fill(username);
    const createResponse = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/admin/users' && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    const response = await createResponse;
    expect(response.ok()).toBeTruthy();
    createdId = ((await response.json()) as { user: { id: string } }).user.id;
    await expect(page.locator('.admin-users-v2__credential-block')).toContainText('Senha temporária');

    const finish = page.getByRole('button', { name: 'Concluir' });
    await finish.click();
    const confirm = page.getByRole('dialog', { name: 'Descartar senha temporária?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(finish).toBeFocused();
    await expect(page.locator('.admin-users-v2__credential-block')).toBeVisible();

    await finish.click();
    await confirm.getByRole('button', { name: 'Cancelar' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator('.admin-users-v2__credential-block')).toBeVisible();

    await finish.click();
    await confirm.getByRole('button', { name: 'Descartar senha' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.locator('.admin-users-v2__credential-block')).toHaveCount(0);
    await expect(page.locator('#admin-users-title')).toHaveText('Usuários');
    expect(nativeDialogs).toEqual([]);
  } finally {
    if (createdId) {
      const deleted = await page.context().request.delete(
        `/api/admin/users/${encodeURIComponent(createdId)}`,
        { headers: { 'X-Home-Music-Request': '1' } }
      );
      expect(deleted.ok()).toBeTruthy();
    }
  }
});
