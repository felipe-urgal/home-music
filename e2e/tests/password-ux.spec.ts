import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

type StoredCredential = {
  id: string;
  password: string;
};

async function installCredentialManagerStub(page: Page) {
  await page.addInitScript(() => {
    class FakePasswordCredential {
      id: string;
      name: string;
      password: string;
      type = 'password';

      constructor(data: { id: string; name?: string; password: string }) {
        this.id = data.id;
        this.name = data.name || data.id;
        this.password = data.password;
      }
    }

    const credentials = {
      store: async (credential: FakePasswordCredential) => {
        (window as Window & { __homeMusicStoredCredential?: StoredCredential }).__homeMusicStoredCredential = {
          id: credential.id,
          password: credential.password
        };
      }
    };

    Object.defineProperty(window, 'PasswordCredential', {
      configurable: true,
      value: FakePasswordCredential
    });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: credentials
    });
  });
}

test('PWA pode pedir ao navegador para salvar a senha após login válido', async ({ page }) => {
  await installCredentialManagerStub(page);
  await page.goto('/');

  const savePassword = page.getByLabel('Salvar senha neste dispositivo');
  await expect(savePassword).toBeVisible();
  await savePassword.check();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const stored = await page.evaluate(() => (
    window as Window & { __homeMusicStoredCredential?: StoredCredential }
  ).__homeMusicStoredCredential);
  expect(stored).toEqual({ id: username, password });
});

test('Alterar senha permite mostrar e ocultar os três campos juntos', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  // O login pode abrir diretamente o player; /account é a rota canônica
  // independentemente da navegação responsiva que estiver montada.
  await page.goto('/account');
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  const viewport = page.viewportSize();
  await page.getByRole('button', { name: /Alterar senha/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Alterar senha');

  // No desktop, os botões de visibilidade ficam dentro dos labels e também
  // correspondem a getByLabel(). Restrinja a seleção aos inputs do formulário.
  const passwordForm = page.locator('#my-account-password-v3-form, form.my-account-password-form');
  const current = passwordForm.locator('input[autocomplete="current-password"]');
  const newPasswords = passwordForm.locator('input[autocomplete="new-password"]');
  const next = newPasswords.nth(0);
  const confirmation = newPasswords.nth(1);
  await expect(current).toHaveCount(1);
  await expect(newPasswords).toHaveCount(2);
  await expect(current).toHaveAttribute('type', 'password');
  await expect(next).toHaveAttribute('type', 'password');
  await expect(confirmation).toHaveAttribute('type', 'password');

  if (viewport && viewport.width >= 1024) {
    const passwordV3 = page.getByTestId('my-account-password-prototype-three');

    await expect(passwordV3).toBeVisible();

    await page.getByRole('button', { name: 'Mostrar senha atual' }).click();
    await expect(current).toHaveAttribute('type', 'text');
    await expect(next).toHaveAttribute('type', 'text');
    await expect(confirmation).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Ocultar senha atual' }).click();
    await expect(current).toHaveAttribute('type', 'password');
    await expect(next).toHaveAttribute('type', 'password');
    await expect(confirmation).toHaveAttribute('type', 'password');

    await current.fill(password);
    await next.fill('abc123');
    await confirmation.fill('abc123');
    await expect(passwordV3.getByRole('button', { name: 'Alterar senha', exact: true })).toBeEnabled();
  } else {
    await page.getByRole('button', { name: 'Mostrar senhas' }).click();
    await expect(current).toHaveAttribute('type', 'text');
    await expect(next).toHaveAttribute('type', 'text');
    await expect(confirmation).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Ocultar senhas' }).click();
    await expect(current).toHaveAttribute('type', 'password');
    await expect(next).toHaveAttribute('type', 'password');
    await expect(confirmation).toHaveAttribute('type', 'password');

    await current.fill(password);
    await next.fill('abc123');
    await confirmation.fill('abc123');
    await expect(page.getByRole('button', { name: 'Alterar senha e sair', exact: true })).toBeEnabled();
  }
});
