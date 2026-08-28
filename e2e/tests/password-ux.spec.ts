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

  const accountEntry = page.getByRole('button', { name: /Minha conta/ }).first();
  await expect(accountEntry).toBeVisible();
  await accountEntry.click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.getByRole('button', { name: /Alterar senha/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Alterar senha');

  const current = page.getByLabel('Senha atual');
  const next = page.getByLabel('Nova senha');
  const confirmation = page.getByLabel('Confirmar nova senha');
  await expect(current).toHaveAttribute('type', 'password');
  await expect(next).toHaveAttribute('type', 'password');
  await expect(confirmation).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Mostrar senhas' }).click();
  await expect(current).toHaveAttribute('type', 'text');
  await expect(next).toHaveAttribute('type', 'text');
  await expect(confirmation).toHaveAttribute('type', 'text');

  await page.getByRole('button', { name: 'Ocultar senhas' }).click();
  await expect(current).toHaveAttribute('type', 'password');
  await expect(next).toHaveAttribute('type', 'password');
  await expect(confirmation).toHaveAttribute('type', 'password');
});
