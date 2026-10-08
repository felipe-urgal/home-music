import { expect, test, type Page } from '@playwright/test';

test('Assistente preserva aba e filtro enquanto carregamento anterior está em voo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  let requested!: () => void;
  const pending = new Promise<void>(resolve => { requested = resolve; });
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let blocked = false;

  await page.route(/\/api\/admin\/library-assistant\/runs\?limit=100$/, async route => {
    if (blocked) return route.continue();
    blocked = true;
    requested();
    await delayed;
    try { await route.continue(); } catch { /* navegação pode abortar o request */ }
  });

  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill('playwright');
  await page.getByLabel('Senha', { exact: true }).fill('playwright-password-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  await page.getByRole('button', { name: 'Expandir barra superior' }).click();
  await page.getByTestId('desktop-sidebar').getByRole('button', { name: /Minha conta/ }).click();
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await page.getByRole('button', { name: /^Assistente da Biblioteca/ }).click();
  await expect(page.locator('#library-assistant-title')).toHaveText('Assistente da Biblioteca');
  await pending;

  const capabilities = page.getByRole('navigation', { name: 'Tipo de análise' });
  const artwork = capabilities.getByRole('button', { name: /Capas/ });
  await artwork.click();
  await expect(artwork).toHaveClass(/is-active/);
  const filter = page.getByRole('region', { name: 'Estados das faixas' }).getByRole('button', { name: /Não analisadas/ });
  await filter.click();
  await expect(filter).toHaveClass(/is-active/);
  const search = page.getByRole('searchbox', { name: 'Buscar faixas' });
  await search.fill('E2E Track');
  release();

  await expect(artwork).toHaveClass(/is-active/);
  await expect(filter).toHaveClass(/is-active/);
  await expect(search).toHaveValue('E2E Track');
  await expect(page.locator('.assistant-tabs__rows')).toContainText('E2E Track');
});
