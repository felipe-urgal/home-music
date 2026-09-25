import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('mobile library prototype one contracts', () => {
  it('carrega o skin mobile depois do protótipo base', () => {
    const main = source('main.tsx');
    expect(main).toMatch(/import '\.\/prototype-one\.css';\s+import '\.\/prototype-one-mobile-library\.css';/);
  });

  it('usa abas no topo e mini-player como retorno persistente ao player no phone', () => {
    const css = source('prototype-one-mobile-library.css');
    const miniPlayer = source('components/MiniPlayer.tsx');

    expect(css).toMatch(/@media \(max-width: 699px\)/);
    expect(css).toMatch(/\.mobile-bottom-nav[\s\S]*display: none !important/);
    expect(css).toMatch(/\.library-tabs[\s\S]*display: grid !important/);
    expect(css).toMatch(/\.mini-player[\s\S]*display: flex !important/);
    expect(miniPlayer).toMatch(/aria-label="Abrir Tocando Agora"/);
  });

  it('mantém o player mobile imersivo sem misturar gesto da capa com play/pause', () => {
    const presentation = source('components/PlayerTrackPresentation.tsx');
    const css = source('mobile-responsive-polish.css');

    expect(presentation).toMatch(/aria-label="Mostrar controles de reprodução"/);
    expect(presentation).toMatch(/aria-label=\{playing \? 'Pausar' : 'Tocar'\}/);
    expect(css).toMatch(/data-mobile-chrome-visible="false"\]\[data-has-artwork="true"\][\s\S]*height: min\(66dvh, 620px\)/);
    expect(css).toMatch(/data-mobile-chrome-visible="false"[\s\S]*\.progress-wrap[\s\S]*bottom: calc\(14px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.player-hero-play__control\.is-hidden[\s\S]*pointer-events: none/);
  });

  it('mantém pastas e playlists como listas compactas navegáveis no mobile', () => {
    const content = source('components/LibraryContent.tsx');

    expect(content).toMatch(/folder-visual-card__mobile-icon/);
    expect(content).toMatch(/folder-order-control/);
    expect(content).toMatch(/folder-visual-card__chevron/);
    expect(content).toMatch(/group-item__chevron/);
    expect(content).toMatch(/aria-label="Ordenar pastas da biblioteca"/);
  });

  it('unifica pastas e playlists no home mobile e exibe todas as coleções', () => {
    const content = source('components/LibraryContent.tsx');
    const css = source('prototype-three-mobile.css');
    const responsiveCss = source('mobile-responsive-polish.css');

    expect(content).toMatch(/mobile-library-home__folders mobile-library-home__playlists/);
    expect(content).toMatch(/visibleFolders\.map/);
    expect(content).toMatch(/renderPlaylistCards\(orderedPlaylists, true\)/);
    expect(content).not.toMatch(/Mostrar todas/);
    expect(content).not.toMatch(/Abrir playlists/);
    expect(content).not.toMatch(/\.slice\(0, 3\)/);
    expect(content).toMatch(/mobile-library-home__folder[\s\S]*folder-visual-card__artwork-mosaic/);
    expect(css).toMatch(/mobile-library-home__folders,[\s\S]*repeat\(auto-fit, minmax\(min\(300px, 100%\), 1fr\)\)/);
    expect(css).toMatch(/mobile-library-home[\s\S]*folder-visual-card__artwork-mosaic[\s\S]*aspect-ratio: 1\.36 \/ 1/);
    expect(css).toMatch(/mobile-library-home__folder strong,[\s\S]*font-size: 14px/);
    expect(responsiveCss).not.toMatch(/mobile-library-home__folders,[\s\S]{0,180}repeat\(2,/);
  });

  it('usa a marca Home Music como acesso ao player no desktop', () => {
    const shell = source('components/DesktopShell.tsx');

    expect(shell).toMatch(/aria-label="Abrir Tocando Agora"/);
    expect(shell).toMatch(/onClick=\{onOpenPlayer\}/);
    expect(shell).not.toMatch(/label="Tocando Agora"/);
    expect(shell).not.toMatch(/label="Pastas"/);
    expect(shell).toMatch(/aria-label="Buscar na biblioteca"/);
    expect(shell).toMatch(/onOpenLibraryTab\('folders'\)/);
  });

  it('amplia a navbar desktop sem perder a composição limpa', () => {
    const css = source('prototype-one.css');

    expect(css).toMatch(/Desktop shell[\s\S]*grid-template-rows: 72px minmax\(0, 1fr\)/);
    expect(css).toMatch(/desktop-brand strong[\s\S]*font-size: 13px/);
    expect(css).toMatch(/desktop-topbar__search svg[\s\S]*width: 19px/);
    expect(css).toMatch(/desktop-player-sidebar-tools__account[\s\S]*width: 38px/);
  });

  it('unifica pastas e playlists na mesma grade e deixa só nova playlist no header desktop', () => {
    const shell = source('components/DesktopShell.tsx');
    const content = source('components/LibraryContent.tsx');
    const navigation = source('components/LibraryNavigationChrome.tsx');
    const libraryNavigation = source('useLibraryNavigation.ts');
    const css = source('prototype-one-desktop-polish.css');

    expect(navigation).not.toMatch(/aria-label="Ordenar pastas"/);
    expect(shell).not.toMatch(/label="Playlists"/);
    expect(content).toMatch(/library-collection-grid/);
    expect(content).toMatch(/library-root-create-playlist/);
    expect(content).toMatch(/Nova playlist/);
    expect(content).toMatch(/renderPlaylistCards\(\)/);
    expect(content).toMatch(/playlist-visual-card/);
    expect(content).toMatch(/playlistArtworkTracks[\s\S]*slice\(0, 4\)/);
    expect(content).toMatch(/playlist-visual-card__artwork-mosaic/);
    expect(content).toMatch(/folder-visual-card__artwork-mosaic/);
    expect(libraryNavigation).toMatch(/folderArtworkTracks\(tracks: Track\[], limit = 4\)/);
    expect(libraryNavigation).toMatch(/artworks: folderArtworkTracks/);
    expect(css).toMatch(/library-collection-grid[\s\S]*minmax\(300px, 1fr\)/);
    expect(css).toMatch(/section-heading--folders-root[\s\S]*justify-content: flex-end/);
    expect(css).toMatch(/library-root-create-playlist[\s\S]*font-size: 13px/);
    expect(css).toMatch(/folder-visual-card__text strong[\s\S]*font-size: 14px/);
    expect(css).toMatch(/library-collection-grid[\s\S]*playlist-visual-card[\s\S]*font-size: 14px/);
  });

  it('usa a mesma grade visual do detalhe nos resultados de busca desktop', () => {
    const content = source('components/LibraryContent.tsx');

    expect(content).toMatch(/desktopVariant=\{folderPath \|\| query \? 'grid' : 'table'\}/);
  });

  it('move play/pause para a capa e usa a próxima faixa como avanço no desktop', () => {
    const screen = source('components/DesktopNowPlayingScreen.tsx');
    const app = source('AuthenticatedApp.tsx');
    const css = source('prototype-one-desktop-polish.css');

    expect(screen).toMatch(/desktop-now-playing-screen__art-frame/);
    expect(screen).toMatch(/desktop-now-playing-screen__cover-play/);
    expect(screen).toMatch(/--wave-fill/);
    expect(screen).toMatch(/--now-playing-wave-accent/);
    expect(screen).toMatch(/loadArtworkAccent/);
    expect(screen).toMatch(/mixArtworkAccents/);
    expect(screen).toMatch(/desktop-now-playing-screen__waveform-hover-time/);
    expect(screen).not.toMatch(/playedWaveBars/);
    expect(screen).toMatch(/nextTrack && nextTrack\.id !== current\.id/);
    expect(screen).toMatch(/desktop-now-playing-screen__next-track/);
    expect(screen).not.toMatch(/aria-label="Anterior"/);
    expect(screen).not.toMatch(/className="desktop-now-playing-screen__play"/);
    expect(screen).not.toMatch(/desktop-now-playing-screen__controls/);
    expect(screen).toMatch(/createPortal/);
    expect(screen).toMatch(/desktop-now-playing-screen__more-menu--portal/);
    expect(screen).toMatch(/Adicionar à playlist/);
    expect(screen).toMatch(/role="menuitemcheckbox"/);
    expect(screen).toMatch(/Aleatório ligado/);
    expect(screen).toMatch(/repeatLabel/);
    expect(screen).toMatch(/CurrentLyricsLine track=\{current\} currentTime=\{currentTime\}/);
    expect(screen).not.toMatch(/<LyricsPanel track=\{current\}/);
    expect(app).toMatch(/nextTrack=\{nextTrack\}/);
    expect(css).toMatch(/desktop-now-playing-screen__more-menu--portal[\s\S]*width: 270px/);
    expect(css).toMatch(/desktop-now-playing-screen__more-submenu/);
    expect(css).toMatch(/desktop-now-playing-screen__more-menu--portal > button[\s\S]*font-size: 13px/);
    expect(css).toMatch(/desktop-now-playing-screen__heading h1[\s\S]*font-size: clamp\(24px, 2\.15vw, 34px\)/);
    expect(css).toMatch(/desktop-now-playing-screen__waveform-progress[\s\S]*width: min\(100%, 470px\)/);
    expect(css).toMatch(/desktop-now-playing-screen__current-lyric[\s\S]*font-family: Georgia/);
    expect(css).toMatch(/desktop-now-playing-screen__current-lyric[\s\S]*color: #f2a25e/);
    expect(css).toMatch(/desktop-now-playing-screen__current-lyric::before[\s\S]*desktop-now-playing-screen__current-lyric::after/);
    expect(css).toMatch(/desktop-now-playing-screen__waveform span[\s\S]*var\(--now-playing-wave-accent, #ff9f49\)[\s\S]*var\(--wave-fill, 0%\)/);
    expect(css).toMatch(/desktop-now-playing-screen__waveform-hover-time[\s\S]*font-variant-numeric: tabular-nums/);
    expect(css).toMatch(/desktop-now-playing-screen__quote[\s\S]*font-size: clamp\(16px, 1\.05vw, 18px\)/);
    expect(css).toMatch(/desktop-now-playing-screen__next-track[\s\S]*width: min\(480px/);
    expect(css).toMatch(/desktop-now-playing-screen__next-track > \.artwork[\s\S]*width: 76px/);
    expect(css).toMatch(/desktop-now-playing-screen__art-frame[\s\S]*width: min\(100%, 500px\)/);
  });

  it('simplifica o detalhe de pasta desktop para capa clicável e grade de faixas', () => {
    const screen = source('components/LibraryScreen.tsx');
    const summary = source('components/DesktopFolderSummary.tsx');
    const rows = source('components/LibraryTrackRows.tsx');
    const css = source('prototype-one-desktop-polish.css');

    expect(screen).toMatch(/desktop-folder-detail-layout/);
    expect(screen).toMatch(/onTogglePlayback=\{\(\) => toggleCollectionPlayback\(folderView\.allTracks\)\}/);
    expect(summary).toMatch(/aria-label=\{playing \? 'Pausar pasta' : 'Tocar pasta'\}/);
    expect(summary).toMatch(/desktop-folder-summary__cover-play/);
    expect(rows).toMatch(/desktopVariant === 'grid'/);
    expect(rows).toMatch(/desktop-track-grid/);
    expect(rows).toMatch(/if \(isCurrent\) onTogglePlay\(\)/);
    expect(rows).toMatch(/isCurrent && playing \? <Pause \/> : <Play \/>/);
    expect(css).toMatch(/desktop-track-grid[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(min-width: 1500px\)[\s\S]*desktop-track-grid[\s\S]*repeat\(5, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/desktop-track-card__copy strong[\s\S]*font-size: 16px/);
    expect(css).toMatch(/desktop-track-card__copy > span[\s\S]*font-size: 13px/);
    expect(css).toMatch(/desktop-folder-summary__identity strong[\s\S]*font-size: 16px/);
    expect(css).toMatch(/desktop-folder-summary__stats dt[\s\S]*font-size: 12px/);
    expect(css).toMatch(/desktop-folder-summary__stats dd[\s\S]*font-size: 15px/);
  });

  it('usa o mesmo detalhe simplificado para playlist desktop', () => {
    const screen = source('components/LibraryScreen.tsx');
    const summary = source('components/DesktopPlaylistSummary.tsx');
    const content = source('components/LibraryContent.tsx');

    expect(screen).toMatch(/desktop-playlist-detail-layout/);
    expect(screen).toMatch(/onTogglePlayback=\{\(\) => toggleCollectionPlayback\(playlistSummaryTracks\)\}/);
    expect(summary).toMatch(/aria-label=\{playing \? 'Pausar playlist' : 'Tocar playlist'\}/);
    expect(content).toMatch(/desktopVariant=\{selectedPlaylist \? 'grid' : 'table'\}/);
    expect(content).toMatch(/selectedPlaylist && !desktopLayout/);
  });
});
