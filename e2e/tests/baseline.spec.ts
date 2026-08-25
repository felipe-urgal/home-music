import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('login, biblioteca e player permanecem utilizáveis', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const viewport = page.viewportSize();
  const sidebar = page.getByTestId('desktop-sidebar');
  const context = page.getByTestId('desktop-context');
  const isDesktop = Boolean(viewport && viewport.width >= 1024);

  if (isDesktop) {
    await expect(sidebar).toBeVisible();
    await expect(context).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
    await expect(context).toContainText('E2E Track');
  } else {
    await expect(sidebar).toBeHidden();
    await expect(context).toBeHidden();
  }

  const playButton = page.getByRole('button', { name: 'Tocar' });
  await expect(playButton).toBeVisible();
  await playButton.click();
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible();

  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await expect(page.locator('.library-header__title strong')).toHaveText('Biblioteca');
  await expect(page.locator('.library-header__title small')).toContainText('1 música');

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Biblioteca' })).toHaveAttribute('aria-current', 'page');
  }

  await page.getByRole('button', { name: 'Músicas', exact: true }).click();
  await expect(page.getByPlaceholder('Música, artista, álbum ou pasta')).toBeVisible();
  await expect(page.locator('.library-track').filter({ hasText: 'E2E Track' })).toBeVisible();

  if (viewport) {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  }

  await page.getByRole('button', { name: 'Voltar ao player' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  if (isDesktop) {
    await expect(sidebar.getByRole('button', { name: 'Tocando agora' })).toHaveAttribute('aria-current', 'page');
  }
});
