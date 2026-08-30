import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openPlaylists(page: Page) {
  const viewport = page.viewportSize();
  const width = viewport?.width ?? 390;

  if (width >= 1024) {
    await page.getByTestId('desktop-sidebar').getByRole('button', { name: 'Playlists', exact: true }).click();
    return;
  }

  if (width >= 700) {
    await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  } else {
    await page.getByRole('navigation', { name: 'Navegação principal' })
      .getByRole('button', { name: 'Biblioteca', exact: true }).click();
  }

  await page.getByRole('navigation', { name: 'Navegação da biblioteca' })
    .getByRole('button', { name: 'Playlists', exact: true }).click();
}

test('cria, pré-visualiza, abre e remove playlist inteligente', async ({ page }, testInfo) => {
  const playlistName = `E2E Inteligente ${testInfo.project.name}`;
  await login(page);
  await openPlaylists(page);

  await page.getByRole('button', { name: 'Inteligente', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova playlist inteligente' });
  await expect(dialog).toBeVisible();

  const viewport = page.viewportSize();
  if (viewport) {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  }

  await dialog.getByLabel('Nome').fill(playlistName);
  await dialog.getByRole('button', { name: 'Gerar preview' }).click();
  await expect(dialog).toContainText('3 músicas encontradas');
  await expect(dialog.getByRole('button', { name: 'Criar playlist' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Criar playlist' }).click();
  await expect(dialog).toBeHidden();

  const playlist = page.getByRole('button').filter({ hasText: playlistName });
  await expect(playlist).toContainText('Inteligente');
  await expect(playlist).toContainText('3 músicas');
  await playlist.click();

  await expect(page.locator('.library-header__title strong')).toContainText(playlistName);
  await expect(page.getByRole('button', { name: 'Editar regra' })).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();

  if ((viewport?.width ?? 390) >= 1024) {
    await expect(page.getByText(playlistName, { exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole('button').filter({ hasText: playlistName })).toHaveCount(0);
  }
});
