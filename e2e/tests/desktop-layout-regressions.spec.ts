import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('player desktop usa navbar superior e mantém superfícies utilitárias livres', async ({ page }) => {
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
  const navigation = topbar.getByRole('navigation', { name: 'Navegação principal' });
  const homeBrand = topbar.getByRole('button', { name: 'Abrir Tocando Agora' });
  const nowPlayingSurface = page.locator('.desktop-now-playing-surface');
  const nowPlaying = page.locator('.desktop-now-playing-screen');
  const nowPlayingArt = page.locator('.desktop-now-playing-screen__art');
  const nowPlayingArtworkSurface = page.locator('.desktop-now-playing-screen__art .now-playing-vinyl__disc');
  const nowPlayingArtFrame = page.locator('.desktop-now-playing-screen__art-frame');
  const nowPlayingContent = page.locator('.desktop-now-playing-screen__content');
  const waveformProgress = page.locator('.desktop-now-playing-screen__waveform-progress');
  const waveformSeek = page.locator('.desktop-now-playing-screen__waveform-seek');
  const waveformBar = page.locator('.desktop-now-playing-screen__waveform span').first();
  const waveformHoverTime = page.locator('.desktop-now-playing-screen__waveform-hover-time');
  const coverPlay = page.locator('.desktop-now-playing-screen__cover-play');
  const moreActions = nowPlaying.getByRole('button', { name: 'Mais opções da faixa' });
  const playerModeControls = page.locator('.desktop-now-playing-screen__controls');
  const desktopLayout = page.locator('.desktop-layout');
  const expandTopbar = page.getByRole('button', { name: 'Expandir barra superior' });

  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'true');
  await expect(topbar).toHaveAttribute('aria-hidden', 'true');
  await expect(expandTopbar).toBeVisible();

  const collapsedTopbarBox = await topbar.boundingBox();
  const collapsedSurfaceBox = await nowPlayingSurface.boundingBox();
  expect(collapsedTopbarBox).not.toBeNull();
  expect(collapsedSurfaceBox).not.toBeNull();
  expect(collapsedTopbarBox!.y).toBeLessThan(0);
  expect(collapsedSurfaceBox!.y).toBeLessThanOrEqual(18);

  await expandTopbar.click();
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'false');
  await expect(topbar).not.toHaveAttribute('aria-hidden', 'true');
  const collapseTopbar = page.getByRole('button', { name: 'Recolher barra superior' });
  await expect(collapseTopbar).toBeVisible();

  await collapseTopbar.click();
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'true');
  await expandTopbar.click();
  await expect(desktopLayout).toHaveAttribute('data-topbar-collapsed', 'false');

  await expect(nowPlayingArt).toBeVisible();
  await expect(nowPlayingArtworkSurface).toBeVisible();
  await expect(nowPlayingArt.locator('.artwork-fallback__label')).toBeVisible();
  await expect(nowPlayingContent).toBeVisible();
  await expect(waveformSeek).toBeVisible();
  await expect(waveformSeek).toHaveAttribute('aria-label', 'Progresso da música');
  await expect(waveformSeek).toHaveAttribute('aria-valuetext', /\d+:\d{2} de \d+:\d{2}/);
  await expect(waveformBar).toHaveAttribute('style', /--wave-fill:/);
  const waveformAccent = await nowPlaying.evaluate(element => (
    getComputedStyle(element).getPropertyValue('--now-playing-wave-accent').trim()
  ));
  expect(waveformAccent).toMatch(/^#[0-9a-f]{6}$/i);
  await waveformProgress.hover({ position: { x: 220, y: 48 } });
  await expect(waveformHoverTime).toBeVisible();
  await expect(waveformHoverTime).toHaveText(/^\d+:\d{2}$/);
  await expect(page.locator('.desktop-now-playing-screen__progress')).toHaveCount(0);
  await expect(coverPlay).toBeVisible();
  await expect(coverPlay).toHaveAttribute('aria-label', /Tocar|Pausar/);
  await expect(playerModeControls).toHaveCount(0);
  await expect(page.locator('.desktop-now-playing-screen__play')).toHaveCount(0);
  await expect(nowPlaying.getByRole('button', { name: 'Adicionar à playlist' })).toHaveCount(0);
  await moreActions.click();
  const moreMenu = page.getByRole('menu', { name: 'Mais opções da faixa' });
  await expect(moreMenu).toBeVisible();
  await expect(moreMenu).toHaveClass(/desktop-now-playing-screen__more-menu--portal/);
  await expect(moreMenu.getByRole('menuitem', { name: 'Adicionar à playlist' })).toBeVisible();
  await expect(moreMenu.getByRole('menuitemcheckbox', { name: /Aleatório/ })).toBeVisible();
  await expect(moreMenu.getByRole('menuitem', { name: /Repetição|Repetir/ })).toBeVisible();
  expect(await moreMenu.evaluate(element => getComputedStyle(element).position)).toBe('fixed');
  expect(await moreMenu.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');

  await moreMenu.getByRole('menuitem', { name: 'Adicionar à playlist' }).click();
  await expect(moreMenu.getByRole('group', { name: 'Adicionar à playlist' })).toBeVisible();
  const scrollWidthWithPlaylistMenu = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidthWithPlaylistMenu).toBeLessThanOrEqual(viewport!.width + 1);

  await nowPlaying.locator('.desktop-now-playing-screen__heading').click();
  await expect(moreMenu).toHaveCount(0);

  await moreActions.click();
  await expect(moreMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(moreMenu).toHaveCount(0);

  await expect(nowPlaying.getByRole('button', { name: 'Anterior', exact: true })).toHaveCount(0);
  await expect(nowPlaying.getByRole('button', { name: 'Próxima', exact: true })).toHaveCount(0);

  const surfaceBox = await nowPlayingSurface.boundingBox();
  const nowPlayingBox = await nowPlaying.boundingBox();
  const artworkBox = await nowPlayingArt.boundingBox();
  const artworkSurfaceBox = await nowPlayingArtworkSurface.boundingBox();
  const artFrameBox = await nowPlayingArtFrame.boundingBox();
  const coverPlayBox = await coverPlay.boundingBox();
  const contentBox = await nowPlayingContent.boundingBox();
  expect(surfaceBox).not.toBeNull();
  expect(nowPlayingBox).not.toBeNull();
  expect(artworkBox).not.toBeNull();
  expect(artworkSurfaceBox).not.toBeNull();
  expect(artFrameBox).not.toBeNull();
  expect(coverPlayBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(surfaceBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(artworkSurfaceBox!.width).toBeGreaterThanOrEqual(300);
  expect(artworkSurfaceBox!.height).toBeGreaterThanOrEqual(300);
  expect(artFrameBox!.width).toBeGreaterThanOrEqual(artworkSurfaceBox!.width - 1);
  expect(Math.abs(coverPlayBox!.x - artFrameBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(coverPlayBox!.y - artFrameBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(coverPlayBox!.width - artFrameBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(coverPlayBox!.height - artFrameBox!.height)).toBeLessThanOrEqual(1);
  expect(coverPlayBox!.width).toBeGreaterThanOrEqual(artworkSurfaceBox!.width - 1);
  expect(coverPlayBox!.height).toBeGreaterThanOrEqual(artworkSurfaceBox!.height - 1);
  expect(artworkBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(contentBox!.y).toBeGreaterThanOrEqual(nowPlayingBox!.y - 1);
  expect(artworkBox!.y + artworkBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(nowPlayingBox!.y + nowPlayingBox!.height + 1);

  await expect(homeBrand).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'Tocando Agora', exact: true })).toHaveCount(0);

  await expect(navigation.getByRole('button', { name: 'Pastas', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('button', { name: 'Playlists', exact: true })).toHaveCount(0);

  const librarySearchTrigger = topbar.getByRole('button', { name: 'Buscar na biblioteca' });
  await librarySearchTrigger.click();
  const librarySearch = page.locator('.search-box--library input');
  await expect(librarySearch).toBeFocused();
  await expect(page.locator('.library-header.is-root .library-header__title strong')).toBeHidden();
  await expect(page.locator('.library-header__folder-meta select')).toHaveCount(0);
  await expect(page.locator('.folder-order-control')).toBeHidden();
  await expect(playerBar).toBeHidden();

  const folderMain = page.locator('.desktop-main-content--library');
  const folderContent = page.locator('.library-content');
  const folderMainBox = await folderMain.boundingBox();
  const folderContentBox = await folderContent.boundingBox();
  expect(folderMainBox).not.toBeNull();
  expect(folderContentBox).not.toBeNull();
  expect(folderMainBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  expect(folderContentBox!.width).toBeGreaterThanOrEqual(folderMainBox!.width * 0.95);

  await expect(librarySearch).toBeFocused();
  await librarySearch.fill('E2E Track');
  const searchResultGrid = page.getByTestId('desktop-track-grid');
  await expect(searchResultGrid).toBeVisible();
  await expect(searchResultGrid.locator('.desktop-track-card').filter({ hasText: 'E2E Track' })).toBeVisible();
  await expect(page.getByTestId('desktop-library-table')).toHaveCount(0);
  const searchTrackControl = searchResultGrid.locator('.desktop-track-card__main').filter({ hasText: 'E2E Track' });
  await expect(searchTrackControl).toHaveAttribute('aria-label', /^(Tocar|Pausar) E2E Track,/);
  const searchTrackTitleSize = Number.parseFloat(
    await searchTrackControl.locator('.desktop-track-card__copy strong').evaluate(element => getComputedStyle(element).fontSize)
  );
  expect(searchTrackTitleSize).toBeGreaterThanOrEqual(16);
  await librarySearch.clear();

  await homeBrand.click();
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  await expect(homeBrand).toHaveAttribute('aria-current', 'page');
  await librarySearchTrigger.click();
  await expect(librarySearch).toBeFocused();

  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(topbarBox!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
  expect(topbarBox!.height).toBeGreaterThanOrEqual(70);
  expect(topbarBox!.height).toBeLessThan(100);
  const brandTextSize = Number.parseFloat(
    await homeBrand.locator('strong').evaluate(element => getComputedStyle(element).fontSize)
  );
  const searchIconWidth = Number.parseFloat(
    await librarySearchTrigger.locator('svg').evaluate(element => getComputedStyle(element).width)
  );
  expect(brandTextSize).toBeGreaterThanOrEqual(13);
  expect(searchIconWidth).toBeGreaterThanOrEqual(19);

  const rootHeading = page.locator('.section-heading--folders-root');
  const playlistCreate = rootHeading.getByRole('button', { name: 'Nova playlist' });
  const collectionGrid = page.locator('.library-collection-grid');
  const playlistCreateBox = await playlistCreate.boundingBox();
  const collectionGridBox = await collectionGrid.boundingBox();

  await expect(playlistCreate).toBeVisible();
  await expect(rootHeading.locator(':scope > span')).toHaveCount(0);
  await expect(rootHeading.locator(':scope > small')).toHaveCount(0);
  await expect(rootHeading.locator('.folder-order-control')).toHaveCount(0);
  await expect(page.locator('.desktop-library-playlists')).toHaveCount(0);
  expect(playlistCreateBox).not.toBeNull();
  expect(collectionGridBox).not.toBeNull();
  expect(collectionGridBox!.width).toBeGreaterThanOrEqual(folderMainBox!.width * 0.95);

  const importedPlaylist = collectionGrid.locator('.playlist-visual-card .group-item__main').filter({ hasText: 'E2E Rekordbox' });
  await expect(importedPlaylist).toBeVisible();
  await importedPlaylist.click();

  const playlistDetail = page.getByTestId('desktop-playlist-detail-layout');
  const playlistSummary = page.getByTestId('desktop-playlist-summary');
  const playlistDetailMain = page.locator('.desktop-playlist-detail-main');
  const playlistCoverPlayback = playlistSummary.getByRole('button', { name: /Tocar playlist|Pausar playlist/ });

  await expect(playlistDetail).toBeVisible();
  await expect(playlistSummary).toBeVisible();
  await expect(playlistCoverPlayback).toBeVisible();
  await expect(playlistCoverPlayback).toBeDisabled();
  await expect(playlistDetailMain.locator('.library-header.is-detail')).toHaveCount(0);
  await expect(page.getByPlaceholder('Buscar nesta playlist…')).toHaveCount(0);
  await expect(page.locator('[aria-label="Filtros rápidos da playlist"]')).toHaveCount(0);
  await expect(playlistDetailMain.getByText('Nenhuma música encontrada.', { exact: true })).toBeVisible();
  await expect(playlistDetailMain.getByTestId('desktop-track-grid')).toHaveCount(0);

  const playlistDetailBox = await playlistDetail.boundingBox();
  const playlistSummaryBox = await playlistSummary.boundingBox();
  const playlistDetailMainBox = await playlistDetailMain.boundingBox();
  const playlistCoverBox = await playlistCoverPlayback.boundingBox();

  expect(playlistDetailBox).not.toBeNull();
  expect(playlistSummaryBox).not.toBeNull();
  expect(playlistDetailMainBox).not.toBeNull();
  expect(playlistCoverBox).not.toBeNull();
  expect(playlistDetailBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  expect(playlistSummaryBox!.x + playlistSummaryBox!.width).toBeLessThanOrEqual(playlistDetailMainBox!.x + 1);
  expect(playlistCoverBox!.width).toBeGreaterThanOrEqual(220);

  const collectionScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(collectionScrollWidth).toBeLessThanOrEqual(viewport!.width + 1);

  await topbar.getByRole('button', { name: /Minha conta/ }).click();
  const accountV3 = page.getByTestId('my-account-prototype-three');
  const accountGrid = accountV3.locator('.my-account-v3__grid');
  const accountProfile = accountV3.locator('.my-account-v3__profile-card');

  await expect(accountV3).toBeVisible();
  await expect(page.locator('.my-account-overview--legacy')).toBeHidden();
  await expect(accountV3.getByRole('heading', { name: /Seu som,\s*suas escolhas\./ })).toBeVisible();
  await expect(accountV3.getByRole('heading', { name: 'O controle é seu' })).toBeVisible();
  await expect(accountProfile).toBeVisible();
  await expect(accountProfile.locator('.my-account-v3__avatar img')).toHaveAttribute('src', '/account-v3-avatar.webp');
  await expect(accountV3.locator('.my-account-v3__aside-quote')).toContainText('Boa música');
  const headphonesBackground = await accountV3.locator('.my-account-v3__headphones').evaluate(element => getComputedStyle(element).backgroundImage);
  expect(headphonesBackground).toContain('account-v3-headphones.webp');
  await expect(accountV3.getByRole('button', { name: 'Alterar senha' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Outros dispositivos' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Apps e integrações' })).toHaveCount(0);
  await expect(accountV3.getByRole('button', { name: 'Importar dados pessoais' })).toHaveCount(0);
  await expect(accountV3.getByRole('button', { name: 'Reprodução' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Administração' })).toBeVisible();
  await expect(accountV3.getByRole('button', { name: 'Sair da conta' })).toBeVisible();
  await expect(playerBar).toBeHidden();

  const accountV3Box = await accountV3.boundingBox();
  const accountGridColumns = await accountGrid.evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  ));
  const accountProfileRadius = Number.parseFloat(
    await accountProfile.evaluate(element => getComputedStyle(element).borderRadius)
  );

  expect(accountV3Box).not.toBeNull();
  expect(accountV3Box!.width).toBeGreaterThanOrEqual(viewport!.width * 0.95);
  expect(accountGridColumns).toBe(3);
  expect(accountProfileRadius).toBeGreaterThanOrEqual(30);

  await accountV3.getByRole('button', { name: 'Outros dispositivos' }).click();
  const sessionsV2 = page.getByTestId('account-sessions-prototype-two');
  const sessionsCards = sessionsV2.locator('.account-sessions-v2__card');
  const currentSessionCard = sessionsV2.locator('.account-sessions-v2__card.is-current');

  await expect(sessionsV2).toBeVisible();
  await expect(sessionsV2.getByRole('button', { name: 'Minha conta', exact: true })).toBeVisible();
  await expect(sessionsV2.getByLabel('Ajuda')).toBeVisible();
  await expect(sessionsV2.getByRole('heading', { name: 'Outros dispositivos', exact: true })).toBeVisible();
  await expect(sessionsV2.getByText('Gerencie as sessões ativas da sua conta.', { exact: true })).toBeVisible();
  await expect(sessionsV2.getByText('Mantenha sua conta segura', { exact: true })).toBeVisible();
  await expect(sessionsV2.getByText('Se não reconhecer um dispositivo, encerre a sessão.', { exact: true })).toBeVisible();
  await expect(sessionsV2.getByRole('heading', { name: 'Sessões ativas', exact: true })).toBeVisible();
  await expect(sessionsCards.first()).toBeVisible();
  await expect(currentSessionCard).toContainText('Este dispositivo');
  await expect(currentSessionCard).toContainText('Atual');
  await expect(currentSessionCard).toContainText('Ativo agora');
  await expect(sessionsV2.getByRole('button', { name: 'Encerrar todas as outras sessões', exact: true })).toBeVisible();
  await expect(sessionsV2.getByText('Isso não afetará este dispositivo.', { exact: true })).toBeVisible();
  await expect(sessionsV2.locator('.account-sessions-v2__workspace')).toHaveCount(0);
  await expect(sessionsV2.locator('.account-sessions-v2__sidebar')).toHaveCount(0);
  await expect(sessionsV2.locator('.account-sessions-v2__detail')).toHaveCount(0);

  const sessionsBox = await sessionsV2.boundingBox();
  const sessionsBackground = await page.locator('.my-account-screen--sessions').evaluate(
    element => getComputedStyle(element).backgroundColor
  );
  const sessionsGrid = sessionsV2.locator('.account-sessions-v2__cards');
  const sessionsColumns = await sessionsGrid.evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
  ));
  const sessionsGridBox = await sessionsGrid.boundingBox();
  const currentSessionBox = await currentSessionCard.boundingBox();

  expect(sessionsBox).not.toBeNull();
  expect(sessionsGridBox).not.toBeNull();
  expect(currentSessionBox).not.toBeNull();
  expect(sessionsBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.95);
  expect(sessionsBackground).not.toBe('rgb(247, 247, 249)');
  expect(sessionsBackground).not.toBe('rgb(255, 255, 255)');
  expect(sessionsColumns).toBe(2);
  expect(currentSessionBox!.width).toBeGreaterThanOrEqual(sessionsGridBox!.width * 0.98);

  await sessionsV2.getByRole('button', { name: 'Minha conta', exact: true }).click();
  await expect(accountV3).toBeVisible();

  await accountProfile.click();
  const profileV1 = page.getByTestId('my-account-profile-prototype-one');
  const profileIdentity = profileV1.locator('.my-account-profile-v1__identity');
  const profileRows = profileV1.locator('.my-account-profile-v1__row');
  const profileSecurity = profileV1.locator('.my-account-profile-v1__security');

  await expect(profileV1).toBeVisible();
  await expect(page.locator('.my-account-profile-page--legacy')).toBeHidden();
  await expect(profileV1.getByRole('heading', { name: 'Seu perfil', exact: true })).toBeVisible();
  await expect(profileV1.getByText('Suas informações, do seu jeito.', { exact: true })).toBeVisible();
  await expect(profileV1.getByText('Boa música', { exact: true })).toBeVisible();
  await expect(profileV1.getByText('vai mais longe.', { exact: true })).toBeVisible();
  await expect(profileV1.locator('.my-account-profile-v1__avatar svg')).toBeVisible();
  await expect(profileV1.getByText('Sessão ativa', { exact: true })).toBeVisible();
  await expect(profileV1.getByText('Informações da conta', { exact: true })).toBeVisible();
  await expect(profileRows).toHaveCount(2);
  await expect(profileRows.nth(0)).toContainText('Nome de usuário');
  await expect(profileRows.nth(1)).toContainText('Tipo de conta');
  await expect(profileV1.getByText('Segurança da conta', { exact: true })).toBeVisible();
  await expect(profileSecurity).toContainText('Sua conta está protegida');
  await expect(profileV1.getByRole('button', { name: 'Alterar senha', exact: true })).toBeVisible();
  await expect(profileV1.getByText('O controle é seu.', { exact: true })).toBeVisible();

  const profileBox = await profileV1.boundingBox();
  const profileIdentityBox = await profileIdentity.boundingBox();
  const profileHeroBox = await profileV1.locator('.my-account-profile-v1__hero').boundingBox();
  const firstProfileRowBox = await profileRows.nth(0).boundingBox();
  const secondProfileRowBox = await profileRows.nth(1).boundingBox();
  const profileHeadphones = await profileV1.locator('.my-account-profile-v1__headphones').evaluate(
    element => getComputedStyle(element).backgroundImage
  );

  expect(profileBox).not.toBeNull();
  expect(profileIdentityBox).not.toBeNull();
  expect(profileHeroBox).not.toBeNull();
  expect(firstProfileRowBox).not.toBeNull();
  expect(secondProfileRowBox).not.toBeNull();
  expect(profileBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.95);
  expect(profileIdentityBox!.width).toBeGreaterThanOrEqual(profileBox!.width * 0.8);
  expect(profileHeroBox!.height).toBeGreaterThanOrEqual(200);
  expect(profileHeroBox!.height).toBeLessThanOrEqual(240);
  expect(secondProfileRowBox!.y).toBeGreaterThan(firstProfileRowBox!.y + firstProfileRowBox!.height - 1);
  expect(profileHeadphones).toContain('profile-v1-headphones.webp');

  await profileV1.getByRole('button', { name: /Minha conta/ }).click();
  await expect(accountV3).toBeVisible();

  await accountV3.getByRole('button', { name: /Administração/ }).click();
  await expect(page.locator('#administration-title')).toHaveText('Administração');
  await expect(playerBar).toBeHidden();

  const usersEntry = page.getByRole('button', { name: /Usuários/ });
  await usersEntry.scrollIntoViewIfNeeded();
  await expect(usersEntry).toBeVisible();
});
