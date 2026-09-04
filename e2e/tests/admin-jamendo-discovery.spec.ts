import { expect, test, type Page } from '@playwright/test';

const adminUsername = 'playwright';
const adminPassword = 'playwright-password-2026';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário', { exact: true }).fill(adminUsername);
  await page.getByLabel('Senha', { exact: true }).fill(adminPassword);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openImport(page: Page) {
  const sidebar = page.getByTestId('desktop-sidebar');
  await sidebar.getByRole('button', { name: /Minha conta/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.locator('.my-account-screen').getByRole('button', { name: /^Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await page.getByRole('button', { name: /^Importar mídia/ }).click();
  await expect(page.locator('#admin-import-title')).toHaveText('Importar mídia');
}

const allowedTrack = {
  sourceId: '123',
  title: 'Ambient livre',
  artist: 'Artista aberto',
  album: 'Álbum aberto',
  durationSeconds: 185,
  thumbnailUrl: null,
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  downloadAllowed: true,
  previewAvailable: true,
  importAllowed: true,
  importBlockReason: null,
  attribution: '“Ambient livre” — Artista aberto · Jamendo'
};

const blockedTrack = {
  sourceId: '456',
  title: 'Ambient restrito',
  artist: 'Artista restrito',
  album: 'Álbum restrito',
  durationSeconds: 92,
  thumbnailUrl: null,
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  downloadAllowed: false,
  previewAvailable: true,
  importAllowed: false,
  importBlockReason: 'download-not-allowed',
  attribution: '“Ambient restrito” — Artista restrito · Jamendo'
};

test('Jamendo mostra licença e bloqueia seleção não elegível no workbench', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  let eligibilityBody: unknown = null;
  let eligibilityHeader: string | undefined;

  await page.route('**/api/admin/imports', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobs: [],
        upload: {
          maxBytes: 1024 * 1024,
          acceptedExtensions: ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']
        },
        url: {
          maxBytes: 1024 * 1024,
          timeoutMs: 5000,
          maxRedirects: 3,
          acceptedProtocols: ['http:', 'https:']
        },
        mediaValidation: {
          profiles: [{ id: 'original', label: 'Original', description: 'Preserva a mídia quando compatível.' }]
        },
        providers: [
          {
            id: 'yt-dlp',
            label: 'yt-dlp',
            configured: true,
            capabilities: { audio: true, metadata: true, thumbnail: true, playlists: true }
          },
          {
            id: 'jamendo',
            label: 'Jamendo · música livre/licenciada',
            configured: true,
            capabilities: { audio: false, metadata: true, thumbnail: true, playlists: false }
          }
        ]
      })
    });
  });

  await page.route('**/api/admin/imports/providers/jamendo/search**', async route => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('q')).toBe('ambient');
    expect(requestUrl.searchParams.get('page')).toBe('1');
    expect(requestUrl.searchParams.get('limit')).toBe('20');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [allowedTrack, blockedTrack],
        pagination: { page: 1, limit: 20, total: 2, nextPage: null }
      })
    });
  });

  await page.route('**/api/admin/imports/providers/jamendo/eligibility', async route => {
    const request = route.request();
    eligibilityBody = request.postDataJSON();
    eligibilityHeader = request.headers()['x-home-music-request'];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ allowed: true, track: allowedTrack })
    });
  });

  await login(page);
  await openImport(page);

  await page.getByRole('tab', { name: /Descobrir no Jamendo/ }).click();
  await page.getByLabel('Buscar músicas no Jamendo').fill('ambient');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();

  const allowed = page.locator('.admin-jamendo-track').filter({ hasText: 'Ambient livre' });
  await expect(allowed).toContainText('Artista aberto · Álbum aberto');
  await expect(allowed).toContainText('3:05');
  await expect(allowed).toContainText('Download permitido');
  await expect(allowed.getByRole('link', { name: /CC BY 4.0/ })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');

  const blocked = page.locator('.admin-jamendo-track').filter({ hasText: 'Ambient restrito' });
  await expect(blocked).toContainText('Download indisponível');
  await expect(blocked).toContainText('O Jamendo não permite download desta faixa.');
  await expect(blocked.getByRole('button', { name: 'Bloqueada' })).toBeDisabled();

  await allowed.getByRole('button', { name: 'Selecionar' }).click();
  await expect(page.getByText('Ambient livre está elegível para importação')).toBeVisible();
  expect(eligibilityBody).toEqual({ sourceId: '123' });
  expect(eligibilityHeader).toBe('1');
});
