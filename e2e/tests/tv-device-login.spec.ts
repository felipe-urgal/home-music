import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = ['playwright', 'password', '2026'].join('-');

async function login(page: Page) {
  await expect(page.getByRole('heading', { name: 'Entrar', exact: true })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('TV entra com aprovação de um celular inicialmente deslogado e mantém sessões independentes', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await page.goto('/?tv=1');
  await expect(page.getByRole('heading', { name: 'Entrar no Home Music' })).toBeVisible();

  const qr = page.locator('[data-tv-approval-url]');
  await expect(qr).toBeVisible();
  const approvalUrl = await qr.getAttribute('data-tv-approval-url');
  expect(approvalUrl).toBeTruthy();
  const tvCode = (await page.locator('[data-tv-display-code]').textContent())?.trim();
  expect(tvCode).toMatch(/^\d{6}$/);

  const origin = new URL(page.url()).origin;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  try {
    await phone.goto(approvalUrl!);
    await login(phone);

    await expect(phone.getByRole('heading', { name: 'Entrar nesta TV?' })).toBeVisible();
    await expect(phone.locator('[data-tv-display-code-phone]')).toHaveText(tvCode!);
    expect(new URL(phone.url()).hash).toBe('');

    await phone.getByRole('button', { name: 'Autorizar', exact: true }).click();
    await expect(phone.getByText('TV autorizada', { exact: false })).toBeVisible();

    await expect(page.locator('.tv-app--now-playing')).toBeVisible({ timeout: 15_000 });

    const tvCookie = (await page.context().cookies(origin))
      .find(cookie => cookie.name === 'home_music_session');
    const phoneCookie = (await phoneContext.cookies(origin))
      .find(cookie => cookie.name === 'home_music_session');
    expect(tvCookie?.value).toBeTruthy();
    expect(phoneCookie?.value).toBeTruthy();
    expect(tvCookie?.value).not.toBe(phoneCookie?.value);

    await page.evaluate(async () => {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Home-Music-Request': '1' }
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Entrar no Home Music' })).toBeVisible();

    await phone.goto(`${origin}/`);
    await expect(phone.locator('.app-shell')).toBeVisible();
  } finally {
    await phoneContext.close();
  }
});

test('TV permite regenerar código e alternar para o login por senha', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await page.goto('/?tv=1');
  const qr = page.locator('[data-tv-approval-url]');
  await expect(qr).toBeVisible();
  const firstApprovalUrl = await qr.getAttribute('data-tv-approval-url');

  await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click();
  await expect(qr).not.toHaveAttribute('data-tv-approval-url', firstApprovalUrl!);

  await page.getByRole('button', { name: 'Entrar com usuário e senha', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Entrar com celular', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entrar no Home Music' })).toBeVisible();
});
