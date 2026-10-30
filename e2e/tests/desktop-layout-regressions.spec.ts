import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('desktop: navbar recolhível, player, busca, playlists e navegação da conta', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const viewport = page.viewportSize();
  test.skip(!viewport || viewport.width < 1024, 'Regressão específica do layout desktop.');

  const topbar = page.getByTestId('desktop-sidebar');
  const playerBar = page.getByTestId('desktop-player-bar');
  const homeBrand = topbar.getByRole('button', { name: 'Abrir Tocando Agora' });
  const nowPlaying = page.locator('.desktop-now-playing-screen');
  const desktopLayout = page.locator('.desktop-layout');
  const expandTopbar = page.getByRole('button', { name: 'Expandir barra superior' });

  // Barra superior recolhível
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'true');
  await expect(topbar).toHaveAttribute('aria-hidden', 'true');
  await expect(expandTopbar).toBeVisible();

  await expandTopbar.click();
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'false');
  await expect(topbar).not.toHaveAttribute('aria-hidden', 'true');
  const collapseTopbar = page.getByRole('button', { name: 'Recolher barra superior' });
  await expect(collapseTopbar).toBeVisible();

  await collapseTopbar.click();
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'true');
  await expandTopbar.click();
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'false');

  // Player: progresso acessível, hover da waveform e menu de ações por teclado
  const waveformSeek = page.locator('.desktop-now-playing-screen__waveform-seek');
  const coverPlay = page.locator('.desktop-now-playing-screen__cover-play');
  await expect(waveformSeek).toBeVisible();
  await expect(waveformSeek).toHaveAttribute('aria-label', 'Progresso da música');
  await expect(waveformSeek).toHaveAttribute('aria-valuetext', /\d+:\d{2} de \d+:\d{2}/);
  await page.locator('.desktop-now-playing-screen__waveform-progress').hover({ position: { x: 220, y: 48 } });
  await expect(page.locator('.desktop-now-playing-screen__waveform-hover-time')).toHaveText(/^\d+:\d{2}$/);
  await expect(coverPlay).toHaveAttribute('aria-label', /Tocar|Pausar/);

  const moreActions = nowPlaying.getByRole('button', { name: 'Mais opções da faixa' });
  await moreActions.click();
  const moreMenu = page.getByRole('menu', { name: 'Mais opções da faixa' });
  const addToPlaylistMenuItem = moreMenu.getByRole('menuitem', { name: 'Adicionar à playlist' });
  const shuffleMenuItem = moreMenu.getByRole('menuitemcheckbox', { name: /Aleatório/ });
  await expect(addToPlaylistMenuItem).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(shuffleMenuItem).toBeFocused();
  await page.keyboard.press('Home');
  await expect(addToPlaylistMenuItem).toBeFocused();
  await expect(moreMenu.getByRole('menuitem', { name: /Repetição|Repetir/ })).toBeVisible();

  await addToPlaylistMenuItem.click();
  await expect(moreMenu.getByRole('group', { name: 'Adicionar à playlist' })).toBeVisible();

  await nowPlaying.locator('.desktop-now-playing-screen__heading').click();
  await expect(moreMenu).toHaveCount(0);

  await moreActions.click();
  await expect(moreMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moreMenu).toHaveCount(0);
  await expect(moreActions).toBeFocused();

  await expect(homeBrand).toHaveAttribute('aria-current', 'page');

  // Busca na biblioteca
  const librarySearchTrigger = topbar.getByRole('button', { name: 'Buscar na biblioteca' });
  await librarySearchTrigger.click();
  const librarySearch = page.locator('.search-box--library input');
  await expect(librarySearch).toBeFocused();
  await expect(playerBar).toBeHidden();

  await librarySearch.fill('E2E Track');
  const searchResultGrid = page.getByTestId('desktop-track-grid');
  await expect(searchResultGrid).toBeVisible();
  await expect(searchResultGrid.locator('.desktop-track-card').filter({ hasText: 'E2E Track' })).toBeVisible();
  const searchTrackControl = searchResultGrid.locator('.desktop-track-card__main').filter({ hasText: 'E2E Track' });
  await expect(searchTrackControl).toHaveAttribute('aria-label', /^(Tocar|Pausar) E2E Track,/);
  await librarySearch.clear();

  await homeBrand.click();
  await expect(nowPlaying).toBeVisible();
  await expect(homeBrand).toHaveAttribute('aria-current', 'page');
  await librarySearchTrigger.click();
  await expect(librarySearch).toBeFocused();

  // Nova playlist
  const rootHeading = page.locator('.section-heading--folders-root');
  const playlistCreate = rootHeading.getByRole('button', { name: 'Nova playlist' });
  await expect(playlistCreate).toBeVisible();
  await playlistCreate.click();
  const createPlaylistDialog = page.getByRole('dialog', { name: 'Nova playlist' });
  const createPlaylistName = createPlaylistDialog.getByLabel('Nome');
  const createPlaylistSubmit = createPlaylistDialog.getByRole('button', { name: 'Criar playlist' });
  await expect(createPlaylistDialog).toBeVisible();
  await expect(createPlaylistName).toBeFocused();
  await expect(createPlaylistSubmit).toBeDisabled();
  await createPlaylistName.fill('Playlist temporária');
  await expect(createPlaylistSubmit).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(createPlaylistDialog).toBeHidden();

  // Playlist importada: abre o detalhe, mas sem faixas locais para tocar
  const importedPlaylist = page
    .locator('.library-collection-grid .playlist-visual-card .group-item__main')
    .filter({ hasText: 'E2E Rekordbox' });
  await expect(importedPlaylist).toBeVisible();
  await importedPlaylist.click();

  const playlistDetail = page.getByTestId('desktop-playlist-detail-layout');
  const playlistSummary = page.getByTestId('desktop-playlist-summary');
  const playlistDetailMain = page.locator('.desktop-playlist-detail-main');
  const playlistCoverPlayback = playlistSummary.getByRole('button', { name: /Tocar playlist|Pausar playlist/ });
  await expect(playlistDetail).toBeVisible();
  await expect(playlistSummary).toBeVisible();
  await expect(playlistCoverPlayback).toBeDisabled();
  await expect(playlistDetailMain.getByText('Nenhuma música encontrada.', { exact: true })).toBeVisible();

  // Conta: visão geral, sessões, perfil e administração
  await topbar.getByRole('button', { name: /Minha conta/ }).click();
  const accountV3 = page.getByTestId('my-account-prototype-three');
  await expect(accountV3).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Alterar senha' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Outros dispositivos' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Reprodução' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Administração' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
  await expect(playerBar).toBeHidden();

  await accountV3.getByRole('button', { name: 'Outros dispositivos' }).click();
  const sessionsV2 = page.getByTestId('account-sessions-prototype-two');
  await expect(sessionsV2).toBeVisible();
  await expect(sessionsV2.getByRole('heading', { name: 'Outros dispositivos', exact: true })).toBeVisible();
  await expect(sessionsV2.getByText('Este dispositivo').first()).toBeVisible();
  await expect(sessionsV2.getByRole('button', { name: 'Encerrar todas as outras sessões', exact: true })).toBeVisible();

  await sessionsV2.getByRole('button', { name: 'Minha conta', exact: true }).click();
  await expect(accountV3).toBeVisible();

  await accountV3.getByRole('button', { name: /^Abrir perfil de/ }).click();
  const profileV1 = page.getByTestId('my-account-profile-prototype-one');
  await expect(profileV1).toBeVisible();
  await expect(profileV1.getByRole('heading', { name: 'Seu perfil', exact: true })).toBeVisible();
  const profileRows = profileV1.locator('.my-account-profile-v1__row');
  await expect(profileRows).toHaveCount(2);
  await expect(profileRows.nth(0)).toContainText('Nome de usuário');
  await expect(profileRows.nth(1)).toContainText('Tipo de conta');
  await expect(profileV1.getByRole('button', { name: 'Alterar senha', exact: true })).toBeVisible();

  await profileV1.getByRole('button', { name: /Minha conta/ }).click();
  await expect(accountV3).toBeVisible();

  await accountV3.getByRole('button', { name: /Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await expect(playerBar).toBeHidden();

  const usersEntry = page.getByRole('button', { name: /Usuários/ });
  await usersEntry.scrollIntoViewIfNeeded();
  await expect(usersEntry).toBeVisible();
});
