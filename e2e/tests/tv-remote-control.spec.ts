import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('celular autenticado na mesma conta controla o player da TV sem criar áudio local', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/?tv=1');
  await expect(page.locator('.tv-app--v2')).toBeVisible();
  await expect(page.locator('.tv-playerbar__track strong')).toHaveText(/E2E/);

  const remoteEntry = page.getByRole('button', { name: 'Conectar controle pelo celular' });
  await remoteEntry.focus();
  await remoteEntry.click();
  const closePairing = page.getByRole('button', { name: 'Fechar controle remoto' });
  const pairingLink = page.locator('.tv-remote-dialog__url');
  await expect(pairingLink).toBeVisible();
  await expect(closePairing).toBeFocused();
  const pairingUrl = await pairingLink.getAttribute('href');
  expect(pairingUrl).toBeTruthy();

  // O modal precisa manter o D-pad dentro dele e devolver o foco ao gatilho ao
  // fechar. O X/Escape só escondem o pareamento: a sessão permanece ativa.
  await page.keyboard.press('ArrowDown');
  await expect(pairingLink).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tv-remote-dialog')).toBeHidden();
  await expect(remoteEntry).toBeFocused();

  const origin = new URL(page.url()).origin;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  try {
    await login(phone, `${origin}/`);
    await expect(phone.locator('.app-shell')).toBeVisible();
    await phone.goto(pairingUrl!);

    await expect(phone.locator('.tv-remote-screen')).toBeVisible();
    await expect(phone.locator('audio')).toHaveCount(0);
    await expect(phone.getByText('Home Music TV', { exact: true })).toBeVisible();

    const tvPlay = page.locator('.tv-playerbar__play');
    const phonePlay = phone.locator('.tv-remote-controls__primary');
    await expect(phonePlay).toBeEnabled();

    const initialAction = await tvPlay.getAttribute('aria-label');
    expect(['Tocar', 'Pausar']).toContain(initialAction);
    await expect(phonePlay).toHaveAttribute('aria-label', initialAction!);

    const toggledAction = initialAction === 'Tocar' ? 'Pausar' : 'Tocar';
    await tvPlay.click();
    await expect(tvPlay).toHaveAttribute('aria-label', toggledAction);
    await expect(phonePlay).toHaveAttribute('aria-label', toggledAction, { timeout: 5_000 });

    await phonePlay.click();
    await expect(tvPlay).toHaveAttribute('aria-label', initialAction!, { timeout: 5_000 });

    const title = page.locator('.tv-playerbar__track strong');
    const beforeTitle = await title.textContent();
    await phone.getByRole('button', { name: 'Próxima faixa', exact: true }).click();
    await expect.poll(async () => title.textContent(), { timeout: 5_000 }).not.toBe(beforeTitle);

    const seek = page.locator('.tv-playerbar__seek');
    const beforeSeek = await seek.getAttribute('aria-label');
    await phone.getByRole('button', { name: 'Avançar 10 segundos', exact: true }).click();
    await expect.poll(async () => seek.getAttribute('aria-label'), { timeout: 5_000 }).not.toBe(beforeSeek);
  } finally {
    await phoneContext.close();
  }
});
