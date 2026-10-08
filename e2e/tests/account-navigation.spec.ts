import { expect, test } from '@playwright/test';

test('navegação de volta em todas as subviews de Minha Conta', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill('playwright');
  await page.getByLabel('Senha', { exact: true }).fill('playwright-password-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  const viewport = page.viewportSize()?.width ?? 0;
  if (viewport >= 700 && viewport < 1024) {
    const back = page.getByRole('button', { name: 'Voltar à biblioteca' });
    if (await back.isVisible()) await back.click();
  }
  await page.getByRole('button', { name: /^(Minha conta|Conta)/ }).first().click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.getByRole('button', { name: /^Abrir perfil de/ }).first().click();
  await expect(page.locator('#my-account-title')).toHaveText('Perfil');
  await page.getByRole('button', { name: 'Voltar', exact: true }).first().click();

  for (const name of ['Alterar senha', 'Outros dispositivos', 'Reprodução', 'Controlador MIDI']) {
    await page.getByRole('button', { name: new RegExp('^' + name) }).first().click();
    await page.getByRole('button', { name: 'Voltar', exact: true }).first().click();
    await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  }
});
