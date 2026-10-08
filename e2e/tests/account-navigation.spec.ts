import { expect, test, type Page } from '@playwright/test';

async function backToOverview(page: Page, view: string) {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  if (desktop && view === 'Perfil') {
    await page.locator('.my-account-profile-v1__back').click();
  } else if (desktop && view === 'Alterar senha') {
    await page.locator('.my-account-password-v3__back').click();
  } else if (desktop && view === 'Outros dispositivos') {
    await page.locator('.account-sessions-v2__topbar button').click();
  } else {
    await page.getByRole('button', { name: 'Voltar', exact: true }).first().click();
  }
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
}

test('navegação de volta em todas as subviews de Minha Conta', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill('playwright');
  await page.getByLabel('Senha', { exact: true }).fill('playwright-password-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  const viewport = page.viewportSize()?.width ?? 0;
  if (viewport >= 1024) {
    await page.getByRole('button', { name: 'Expandir barra superior' }).click();
    await page.getByTestId('desktop-sidebar').getByRole('button', { name: /Minha conta/ }).click();
  } else {
    if (viewport < 700) {
      // No mobile a seta de retorno do player fica oculta por design.
      await page.goto('/library');
      await page.locator('.mobile-library-brand-bar').getByRole('button', { name: /Minha conta/ }).click();
    } else {
      await page.locator('.player-topbar').getByRole('button', { name: 'Biblioteca', exact: true }).click();
      await page.locator('.my-account-mobile-entry').click();
    }
  }
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.getByRole('button', { name: /^Abrir perfil de/ }).first().click();
  await expect(page.locator('#my-account-title')).toHaveText('Perfil');
  await backToOverview(page, 'Perfil');

  for (const name of ['Alterar senha', 'Outros dispositivos', 'Reprodução', 'Controlador MIDI']) {
    await page.getByRole('button', { name: new RegExp('^' + name) }).first().click();
    await backToOverview(page, name);
  }
});
