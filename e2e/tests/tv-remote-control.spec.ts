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

test('TV mostra o now playing aprovado e celular autenticado controla a reprodução', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/?tv=1');
  await expect(page.locator('.tv-app--now-playing')).toBeVisible();
  await expect(page.locator('.tv-now-playing__title')).toHaveText(/E2E/);
  await expect(page.getByText('Home Music', { exact: true })).toBeVisible();
  await expect(page.getByText('TOCANDO AGORA', { exact: true })).toBeVisible();
  await expect(page.getByText(/Good music/)).toBeVisible();

  const pairingLink = page.getByRole('link', { name: 'Abrir controle no celular' });
  await expect(pairingLink).toBeVisible();
  await expect(pairingLink.locator('img')).toHaveAttribute('alt', 'QR code para controlar a TV pelo celular');
  const pairingUrl = await pairingLink.getAttribute('href');
  expect(pairingUrl).toBeTruthy();

  await expect(page.getByRole('button', { name: 'Aleatório', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Faixa anterior', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Próxima faixa', exact: true })).toBeEnabled();

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

    const tvPlay = page.locator('.tv-now-playing__play');
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

    const title = page.locator('.tv-now-playing__title');
    const beforeTitle = await title.textContent();
    await phone.getByRole('button', { name: 'Próxima faixa', exact: true }).click();
    await expect.poll(async () => title.textContent(), { timeout: 5_000 }).not.toBe(beforeTitle);

    const progress = page.locator('.tv-now-playing__progress');
    const beforeSeek = await progress.getAttribute('aria-label');
    await phone.getByRole('button', { name: 'Avançar 10 segundos', exact: true }).click();
    await expect.poll(async () => progress.getAttribute('aria-label'), { timeout: 5_000 }).not.toBe(beforeSeek);
  } finally {
    await phoneContext.close();
  }
});
