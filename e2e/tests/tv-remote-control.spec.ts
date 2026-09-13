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

test('TV mostra o now playing e celular autenticado controla a reprodução', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  await login(page, '/?tv=1');
  await expect(page.locator('.tv-app--now-playing')).toBeVisible();
  await expect(page.locator('.tv-now-playing__title')).toHaveText(/E2E/);
  await expect(page.getByText('Home Music', { exact: true })).toBeVisible();

  const remoteEntry = page.getByRole('button', { name: 'Controlar pelo celular', exact: true });
  const pairingLink = page.getByRole('link', { name: 'Abrir controle no celular' });
  await expect(remoteEntry).toBeVisible();
  await expect(pairingLink).toHaveCount(0);

  await remoteEntry.click();
  await expect(pairingLink).toBeVisible();
  await expect(pairingLink.locator('img')).toHaveAttribute('alt', 'QR code para controlar a TV pelo celular');

  const entryBox = await remoteEntry.boundingBox();
  const qrBox = await pairingLink.boundingBox();
  expect(entryBox).not.toBeNull();
  expect(qrBox).not.toBeNull();
  expect(qrBox!.y).toBeGreaterThanOrEqual(entryBox!.y + entryBox!.height);

  const pairingUrl = await pairingLink.getAttribute('href');
  expect(pairingUrl).toBeTruthy();

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
    await expect(phone.getByText('TV conectada', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(pairingLink).toHaveCount(0);
    await expect(remoteEntry).toBeVisible();

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
    await remoteEntry.focus();
    await expect(remoteEntry).toBeFocused();
    await phone.getByRole('button', { name: 'Próxima faixa', exact: true }).click();
    await expect.poll(async () => title.textContent(), { timeout: 5_000 }).not.toBe(beforeTitle);
    await expect(remoteEntry).toBeFocused();

    const shuffle = phone.getByRole('button', { name: 'Aleatório', exact: true });
    const initialShuffle = await shuffle.getAttribute('aria-pressed');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', initialShuffle === 'true' ? 'false' : 'true', { timeout: 5_000 });

    const repeat = phone.getByRole('button', { name: /Repetição desligada|Repetir fila|Repetir uma/ });
    const repeatLabel = await repeat.getAttribute('aria-label');
    const repeatClicks = repeatLabel === 'Repetição desligada' ? 2 : repeatLabel === 'Repetir fila' ? 1 : 0;
    for (let index = 0; index < repeatClicks; index += 1) await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repetir uma', { timeout: 5_000 });

    const currentTitle = await title.textContent();
    await expect(page.locator('.tv-now-playing__next-copy p')).toContainText(currentTitle!);

    const libraryEntry = phone.getByRole('button', { name: /Biblioteca/ });
    await libraryEntry.focus();
    await libraryEntry.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
    const backToControl = phone.getByRole('button', { name: 'Voltar ao controle' });
    await expect(backToControl).toBeFocused();
    await expect(phone.getByPlaceholder('Buscar música, artista ou álbum…')).toBeVisible();
    await backToControl.press('Enter');
    await expect(libraryEntry).toBeFocused();
  } finally {
    await phoneContext.close();
  }
});
