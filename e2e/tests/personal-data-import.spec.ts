import { expect, test, type Page, type TestInfo } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const fixedTimestamp = '2026-09-06T12:00:00.000Z';

type PlaybackState = {
  currentTrackId: string | null;
  position: number;
  volume: number;
  shuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  wasPlaying: boolean;
  baseQueueIds: string[];
  queueIds: string[];
  updatedAt: string;
};

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();
}

async function openPersonalImport(page: Page) {
  await page.goto('/account');
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await page.getByRole('button', { name: /Importar dados pessoais/ }).click();
  await expect(page.locator('#my-account-title')).toHaveText('Importar dados pessoais');
  await expect(page.getByText('Use um JSON exportado pelo Home Music.')).toBeVisible();
}

function bundle(manualPlaylistName: string, version = 1) {
  return {
    format: 'home-music-personal-data',
    version,
    exportedAt: fixedTimestamp,
    favorites: [],
    manualPlaylists: [{
      name: manualPlaylistName,
      tracks: [],
      createdAt: fixedTimestamp,
      updatedAt: fixedTimestamp
    }],
    smartPlaylists: [],
    libraryViews: [],
    playbackHistory: [],
    playbackState: {
      currentTrack: null,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueue: [],
      queue: [],
      updatedAt: fixedTimestamp
    }
  };
}

async function apiJson<T>(page: Page, url: string, init?: RequestInit) {
  return page.evaluate(async ({ requestUrl, requestInit }) => {
    const response = await fetch(requestUrl, requestInit);
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${requestUrl}`);
    return response.json();
  }, { requestUrl: url, requestInit: init }) as Promise<T>;
}

async function restorePlaybackState(page: Page, state: PlaybackState) {
  await page.evaluate(async original => {
    await fetch('/api/player/state', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      },
      body: JSON.stringify(original)
    });
  }, state);
}

async function deletePlaylistIfPresent(page: Page, name: string) {
  const playlists = await apiJson<{ playlists: Array<{ id: string; name: string }> }>(page, '/api/playlists');
  const playlist = playlists.playlists.find(item => item.name === name);
  if (!playlist) return;
  await page.evaluate(async id => {
    await fetch(`/api/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Home-Music-Request': '1' }
    });
  }, playlist.id);
}

function testPlaylistName(testInfo: TestInfo) {
  return `E2E Import ${testInfo.project.name} retry-${testInfo.retry}`;
}

test('Minha Conta faz preview antes de confirmar e aplica o bundle real', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Importação de dados pessoais fica oculta no mobile.');

  await login(page);
  const originalPlaybackState = await apiJson<PlaybackState>(page, '/api/player/state');
  const playlistName = testPlaylistName(testInfo);

  try {
    await openPersonalImport(page);
    await page.getByLabel('Arquivo JSON').setInputFiles({
      name: 'home-music-personal-data.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bundle(playlistName)))
    });

    await expect(page.getByText('Preview da importação')).toBeVisible();
    await expect(page.getByText('Nenhuma alteração foi aplicada ainda.')).toBeVisible();
    const applyButton = page.getByRole('button', { name: 'Confirmar e importar' });
    await expect(applyButton).toBeDisabled();

    const before = await apiJson<{ playlists: Array<{ name: string }> }>(page, '/api/playlists');
    expect(before.playlists.some(item => item.name === playlistName)).toBe(false);

    await page.getByRole('checkbox', {
      name: /Revisei o preview e quero aplicar somente os dados/
    }).check();
    await expect(applyButton).toBeEnabled();
    await applyButton.click();

    await expect(page.getByText('Importação concluída')).toBeVisible();
    await expect(page.getByText('Os dados resolvidos com segurança foram aplicados à sua conta.')).toBeVisible();

    const after = await apiJson<{ playlists: Array<{ name: string }> }>(page, '/api/playlists');
    expect(after.playlists.some(item => item.name === playlistName)).toBe(true);
  } finally {
    await deletePlaylistIfPresent(page, playlistName);
    await restorePlaybackState(page, originalPlaybackState);
  }
});

test('bundle incompatível mostra erro do backend e nunca oferece confirmação', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'Importação de dados pessoais fica oculta no mobile.');

  await login(page);
  await openPersonalImport(page);

  await page.getByLabel('Arquivo JSON').setInputFiles({
    name: 'home-music-unsupported.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle(testPlaylistName(testInfo), 999)))
  });

  await expect(page.getByRole('alert')).toContainText('Bundle de dados pessoais inválido');
  await expect(page.getByText('Preview da importação')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar e importar' })).toHaveCount(0);
});

test('mobile oculta a importação de dados pessoais', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'A regra de visibilidade é exclusiva do mobile.');

  await login(page);
  await page.goto('/account');
  await expect(page.locator('#my-account-title')).toHaveText('Minha conta');
  await expect(page.getByRole('button', { name: /Importar dados pessoais/ })).toHaveCount(0);
});
