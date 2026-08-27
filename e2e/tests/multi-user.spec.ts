import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';

function viewportWidth(page: Page) {
  const width = page.viewportSize()?.width;
  if (!width) throw new Error('Viewport E2E não configurada.');
  return width;
}

async function submitLogin(page: Page, username: string, password: string) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function login(page: Page, username: string, password: string) {
  await submitLogin(page, username, password);
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function resetBrowserSession(page: Page) {
  await page.context().clearCookies();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
}

async function openPlaylists(page: Page) {
  const width = viewportWidth(page);

  if (width >= 1024) {
    const sidebar = page.getByTestId('desktop-sidebar');
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole('button', { name: 'Playlists', exact: true }).click();
  } else {
    if (width < 700) {
      const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
      await expect(navigation).toBeVisible();
      await navigation.getByRole('button', { name: 'Biblioteca', exact: true }).click();
    } else {
      const backToLibrary = page.getByRole('button', { name: 'Voltar à biblioteca', exact: true });
      if (await backToLibrary.isVisible()) await backToLibrary.click();
    }

    const libraryNavigation = page.getByRole('navigation', { name: 'Navegação da biblioteca' });
    await expect(libraryNavigation).toBeVisible();
    await libraryNavigation.getByRole('button', { name: 'Playlists', exact: true }).click();
  }

  await expect(page.locator('.section-heading > span').filter({ hasText: /^Playlists$/ })).toBeVisible();
}

async function expectAdminLibrarySurface(page: Page, visible: boolean) {
  const width = viewportWidth(page);
  const refresh = width >= 1024
    ? page.getByTestId('desktop-sidebar').getByRole('button', { name: 'Atualizar biblioteca', exact: true })
    : page.getByRole('button', { name: 'Atualizar biblioteca', exact: true });

  if (visible) await expect(refresh).toBeVisible();
  else await expect(refresh).toHaveCount(0);

  if (width >= 700 && width < 1024) {
    const adminEntry = page.getByRole('button', { name: 'Administração · Usuários', exact: true });
    if (visible) await expect(adminEntry).toBeVisible();
    else await expect(adminEntry).toHaveCount(0);
  }
}

async function createPlaylist(page: Page, name: string) {
  await openPlaylists(page);
  page.once('dialog', dialog => dialog.accept(name));
  await page.getByRole('button', { name: 'Nova', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

async function openAccountFromLibrary(page: Page) {
  const width = viewportWidth(page);

  if (width >= 1024) {
    const sidebar = page.getByTestId('desktop-sidebar');
    await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  } else if (width < 700) {
    const navigation = page.getByRole('navigation', { name: 'Navegação principal' });
    await navigation.getByRole('button', { name: 'Conta', exact: true }).click();
  } else {
    await page.getByRole('button', { name: /Minha conta ·/ }).click();
  }

  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
}

test('admin e user preservam role, troca de senha e isolamento em todos os layouts', async ({ page }, testInfo) => {
  const projectSlug = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const retrySuffix = `r${testInfo.retry}`;
  const userUsername = `e2e-user-${projectSlug}-${retrySuffix}`;
  const userPassword = `E2E-${projectSlug}-${retrySuffix}-password-2026`;
  const adminPlaylist = `Admin ${projectSlug} ${retrySuffix}`;
  const userPlaylist = `User ${projectSlug} ${retrySuffix}`;

  await login(page, adminUsername, adminPassword);
  await createPlaylist(page, adminPlaylist);
  await expectAdminLibrarySurface(page, true);
  await openAccountFromLibrary(page);

  await expect(page.getByLabel('Identidade atual')).toContainText(adminUsername);
  await expect(page.getByLabel('Identidade atual')).toContainText('Administrador');
  await expect(page.locator('#my-account-group-admin')).toHaveText('Administração');

  await page.getByRole('button', { name: /^Usuários/ }).click();
  await expect(page.locator('#admin-users-title')).toHaveText('Usuários');
  await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
  await expect(page.locator('#admin-users-title')).toHaveText('Novo usuário');
  await page.getByLabel('Nome de usuário', { exact: true }).fill(userUsername);
  await page.getByRole('button', { name: 'Criar usuário', exact: true }).click();

  const credential = page.locator('.admin-users-credential');
  await expect(credential).toContainText(`Conta criada · ${userUsername}`);
  const temporaryPassword = (await credential.locator('code').textContent())?.trim();
  expect(temporaryPassword).toBeTruthy();

  await resetBrowserSession(page);
  await submitLogin(page, userUsername, temporaryPassword!);
  await expect(page.getByRole('heading', { name: 'Defina uma nova senha' })).toBeVisible();
  await page.getByLabel('Senha temporária', { exact: true }).fill(temporaryPassword!);
  await page.getByLabel('Nova senha', { exact: true }).fill(userPassword);
  await page.getByLabel('Confirmar nova senha', { exact: true }).fill(userPassword);
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await login(page, userUsername, userPassword);
  await openPlaylists(page);

  await expectAdminLibrarySurface(page, false);
  await expect(page.getByText(adminPlaylist, { exact: true })).toHaveCount(0);
  await createPlaylist(page, userPlaylist);
  await openAccountFromLibrary(page);

  await expect(page.getByLabel('Identidade atual')).toContainText(userUsername);
  await expect(page.getByLabel('Identidade atual')).toContainText('Usuário');
  await expect(page.locator('#my-account-group-admin')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Usuários/ })).toHaveCount(0);

  await resetBrowserSession(page);
  await login(page, adminUsername, adminPassword);
  await openPlaylists(page);

  await expectAdminLibrarySurface(page, true);
  await expect(page.getByText(adminPlaylist, { exact: true })).toBeVisible();
  await expect(page.getByText(userPlaylist, { exact: true })).toHaveCount(0);
});
