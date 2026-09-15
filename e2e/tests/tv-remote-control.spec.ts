import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = ['playwright', 'password', '2026'].join('-');

const remoteRootTracks = Array.from({ length: 81 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    id: `remote-root-${number}`,
    title: `Faixa raiz ${number}`,
    artist: 'Artista E2E',
    album: 'Álbum E2E',
    albumArtist: 'Artista E2E',
    folder: '',
    folderPath: '',
    duration: 180,
    format: 'mp3',
    hasCover: false
  };
});

const remoteFolderTracks = Array.from({ length: 81 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0');
  return {
    id: `remote-mpb-${number}`,
    title: `Faixa MPB ${number}`,
    artist: 'Artista MPB',
    album: 'Álbum MPB',
    albumArtist: 'Artista MPB',
    folder: 'MPB',
    folderPath: 'MPB',
    duration: 180,
    format: 'mp3',
    hasCover: false
  };
});

const remotePlaylist = {
  id: 'remote-playlist-81',
  name: 'Playlist 81',
  trackIds: remoteRootTracks.map(track => track.id),
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
  source: 'manual'
};

async function login(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário', { exact: true }).fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function mockRemoteLibrary(page: Page) {
  await page.route('**/api/library', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tracks: [...remoteRootTracks, ...remoteFolderTracks],
      scannedAt: '2026-09-13T00:00:00.000Z',
      scanning: false,
      revision: 1
    })
  }));
  await page.route('**/api/playlists', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ playlists: [remotePlaylist] })
  }));
  await page.route('**/api/smart-playlists', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ playlists: [] })
  }));
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

  const tvPlay = page.locator('.tv-now-playing__art');
  const tvNext = page.locator('.tv-now-playing__next');
  await expect(tvPlay).toBeEnabled();
  await expect(tvNext).toBeEnabled();
  await expect(tvNext).toHaveAttribute('aria-label', /^Tocar próxima faixa: /);
  await expect(page.getByRole('button', { name: 'Faixa anterior', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Próxima faixa', exact: true })).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  try {
    await login(phone, `${origin}/`);
    await expect(phone.locator('.app-shell')).toBeVisible();
    await mockRemoteLibrary(phone);
    await phone.goto(pairingUrl!);

    await expect(phone.locator('.tv-remote-screen')).toBeVisible();
    await expect(phone.locator('audio')).toHaveCount(0);
    await expect(phone.getByText('TV conectada', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(pairingLink).toHaveCount(0);
    await expect(remoteEntry).toBeVisible();

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
    await expect(tvNext).toContainText('A SEGUIR');
    await expect(tvNext).not.toContainText(currentTitle!);

    const libraryEntry = phone.getByRole('button', { name: /Biblioteca/ });
    await libraryEntry.focus();
    await libraryEntry.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();

    const libraryBack = phone.getByRole('button', { name: 'Voltar', exact: true });
    const search = phone.getByPlaceholder('Buscar música, artista ou álbum…');
    await expect(libraryBack).toBeFocused();
    await expect(search).toHaveCount(0);

    const foldersEntry = phone.getByRole('button', { name: /^Pastas/ });
    await foldersEntry.focus();
    await foldersEntry.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Pastas' })).toBeVisible();
    await expect(libraryBack).toBeFocused();
    await expect(search).toHaveCount(0);

    const rootTrackButtons = phone.getByRole('button', { name: /Faixa raiz/ });
    await expect(rootTrackButtons).toHaveCount(40);
    const rootTrack41 = phone.getByRole('button', { name: /Faixa raiz 41/ });
    const rootTrack81 = phone.getByRole('button', { name: /Faixa raiz 81/ });
    await expect(rootTrack41).toHaveCount(0);
    await expect(rootTrack81).toHaveCount(0);
    const showMoreRoot = phone.getByRole('button', { name: 'Mostrar mais músicas', exact: true });
    await showMoreRoot.focus();
    await showMoreRoot.press('Enter');
    await expect(rootTrackButtons).toHaveCount(80);
    await expect(rootTrack41).toBeVisible();
    await expect(rootTrack81).toHaveCount(0);
    await expect(showMoreRoot).toBeVisible();
    await expect(showMoreRoot).toBeFocused();
    await showMoreRoot.press('Enter');
    await expect(rootTrackButtons).toHaveCount(81);
    await expect(rootTrack81).toBeVisible();
    await expect(rootTrack81).toBeFocused();
    await expect(showMoreRoot).toHaveCount(0);

    const mpbEntry = phone.getByRole('button', { name: /^MPB/ });
    await mpbEntry.focus();
    await mpbEntry.press('Enter');
    await expect(phone.getByRole('heading', { name: 'MPB' })).toBeVisible();
    await expect(libraryBack).toBeFocused();
    await expect(search).toBeVisible();

    const folderTrackButtons = phone.getByRole('button', { name: /Faixa MPB/ });
    await expect(folderTrackButtons).toHaveCount(40);
    const folderTrack41 = phone.getByRole('button', { name: /Faixa MPB 41/ });
    const folderTrack81 = phone.getByRole('button', { name: /Faixa MPB 81/ });
    await expect(folderTrack41).toHaveCount(0);
    await expect(folderTrack81).toHaveCount(0);
    const showMoreFolder = phone.getByRole('button', { name: 'Mostrar mais músicas', exact: true });
    await showMoreFolder.focus();
    await showMoreFolder.press('Enter');
    await expect(folderTrackButtons).toHaveCount(80);
    await expect(folderTrack41).toBeVisible();
    await expect(folderTrack81).toHaveCount(0);
    await expect(showMoreFolder).toBeVisible();
    await expect(showMoreFolder).toBeFocused();
    await showMoreFolder.press('Enter');
    await expect(folderTrackButtons).toHaveCount(81);
    await expect(folderTrack81).toBeVisible();
    await expect(folderTrack81).toBeFocused();
    await expect(showMoreFolder).toHaveCount(0);

    await libraryBack.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Pastas' })).toBeVisible();
    await expect(libraryBack).toBeFocused();
    await libraryBack.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
    await expect(libraryBack).toBeFocused();

    const playlistsEntry = phone.getByRole('button', { name: /^Playlists/ });
    await playlistsEntry.focus();
    await playlistsEntry.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Playlists' })).toBeVisible();
    await expect(libraryBack).toBeFocused();

    const playlistEntry = phone.getByRole('button', { name: /^Playlist 81/ });
    await playlistEntry.focus();
    await playlistEntry.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Playlist 81' })).toBeVisible();
    await expect(libraryBack).toBeFocused();
    await expect(search).toBeVisible();

    const playlistTrackButtons = phone.getByRole('button', { name: /Faixa raiz/ });
    await expect(playlistTrackButtons).toHaveCount(40);
    await expect(playlistTrackButtons.nth(0)).toContainText('Faixa raiz 01');
    const playlistTrack41 = playlistTrackButtons.nth(40);
    const playlistTrack81 = playlistTrackButtons.nth(80);
    const showMorePlaylist = phone.getByRole('button', { name: 'Mostrar mais músicas', exact: true });
    await showMorePlaylist.focus();
    await showMorePlaylist.press('Enter');
    await expect(playlistTrackButtons).toHaveCount(80);
    await expect(playlistTrack41).toContainText('Faixa raiz 41');
    await expect(showMorePlaylist).toBeVisible();
    await expect(showMorePlaylist).toBeFocused();
    await showMorePlaylist.press('Enter');
    await expect(playlistTrackButtons).toHaveCount(81);
    await expect(playlistTrack81).toContainText('Faixa raiz 81');
    await expect(playlistTrack81).toBeFocused();
    await expect(showMorePlaylist).toHaveCount(0);

    await libraryBack.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Playlists' })).toBeVisible();
    await expect(libraryBack).toBeFocused();
    await libraryBack.press('Enter');
    await expect(phone.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
    await expect(libraryBack).toBeFocused();
    await libraryBack.press('Enter');
    await expect(libraryEntry).toBeFocused();
  } finally {
    await phoneContext.close();
  }
});
