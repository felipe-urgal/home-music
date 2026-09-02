import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

test('refresh manual apos scan mantém biblioteca consistente e revalida o snapshot', async ({ page }) => {
  await login(page);

  const before = await page.request.get('/api/library', {
    headers: { 'Accept-Encoding': 'identity' }
  });
  expect(before.status()).toBe(200);
  const beforeEtag = before.headers().etag;
  expect(beforeEtag).toBeTruthy();
  const beforePayload = await before.json() as { tracks: unknown[]; revision: number };
  expect(beforePayload.tracks).toHaveLength(3);

  const scanResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/library/scan')
    && response.request().method() === 'POST'
  );
  const refreshedLibraryResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/library')
    && response.request().method() === 'GET'
  );

  await page.getByRole('button', { name: 'Atualizar biblioteca', exact: true }).click();

  const [scan, refreshed] = await Promise.all([scanResponse, refreshedLibraryResponse]);
  expect(scan.status()).toBe(200);
  expect(refreshed.status()).toBe(200);
  await expect(page.getByText('E2E Track', { exact: true }).first()).toBeVisible();

  const after = await page.request.get('/api/library', {
    headers: {
      'Accept-Encoding': 'identity',
      'If-None-Match': beforeEtag
    }
  });
  expect(after.status()).toBe(200);
  const afterPayload = await after.json() as { tracks: unknown[]; revision: number };
  expect(afterPayload.tracks).toHaveLength(3);
  expect(afterPayload.revision).toBe(beforePayload.revision);
  expect(after.headers().etag).not.toBe(beforeEtag);

  const unchanged = await page.request.get('/api/library', {
    headers: {
      'Accept-Encoding': 'identity',
      'If-None-Match': after.headers().etag
    }
  });
  expect(unchanged.status()).toBe(304);
});
