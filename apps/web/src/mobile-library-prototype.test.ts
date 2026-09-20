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

  it('mantém pastas e playlists como listas compactas navegáveis no mobile', () => {
    const content = source('components/LibraryContent.tsx');

    expect(content).toMatch(/folder-visual-card__mobile-icon/);
    expect(content).toMatch(/folder-order-control/);
    expect(content).toMatch(/folder-visual-card__chevron/);
    expect(content).toMatch(/group-item__chevron/);
    expect(content).toMatch(/aria-label="Ordenar pastas da biblioteca"/);
  });

  it('usa a marca Home Music como acesso ao player no desktop', () => {
    const shell = source('components/DesktopShell.tsx');

    expect(shell).toMatch(/aria-label="Abrir Tocando Agora"/);
    expect(shell).toMatch(/onClick=\{onOpenPlayer\}/);
    expect(shell).not.toMatch(/label="Tocando Agora"/);
  });

  it('usa largura total e a mesma grade visual em pastas e playlists desktop', () => {
    const content = source('components/LibraryContent.tsx');
    const navigation = source('components/LibraryNavigationChrome.tsx');
    const css = source('prototype-one-desktop-polish.css');

    expect(navigation).not.toMatch(/aria-label="Ordenar pastas"/);
    expect(content).toMatch(/playlist-visual-grid/);
    expect(content).toMatch(/playlist-visual-card/);
    expect(css).toMatch(/grid-template-columns: repeat\(auto-fill, minmax\(230px, 1fr\)\)/);
    expect(css).toMatch(/playlist-order-control[\s\S]*display: none !important/);
  });

  it('move play/pause para a capa e usa a próxima faixa como avanço no desktop', () => {
    const screen = source('components/DesktopNowPlayingScreen.tsx');
    const app = source('AuthenticatedApp.tsx');
    const css = source('prototype-one-desktop-polish.css');

    expect(screen).toMatch(/desktop-now-playing-screen__cover-play/);
    expect(screen).toMatch(/nextTrack && nextTrack\.id !== current\.id/);
    expect(screen).toMatch(/desktop-now-playing-screen__next-track/);
    expect(screen).not.toMatch(/aria-label="Anterior"/);
    expect(screen).not.toMatch(/className="desktop-now-playing-screen__play"/);
    expect(app).toMatch(/nextTrack=\{nextTrack\}/);
    expect(css).toMatch(/desktop-now-playing-screen__controls[\s\S]*grid-template-columns: repeat\(2, 46px\)/);
    expect(css).toMatch(/desktop-now-playing-screen__heading h1[\s\S]*font-size: clamp\(24px, 2\.15vw, 34px\)/);
    expect(css).toMatch(/desktop-now-playing-screen__waveform-progress[\s\S]*width: min\(100%, 470px\)/);
    expect(css).toMatch(/now-playing-vinyl[\s\S]*max-width: 500px/);
  });

  it('aplica o protótipo 2 na listagem de pasta desktop', () => {
    const screen = source('components/LibraryScreen.tsx');
    const summary = source('components/DesktopFolderSummary.tsx');
    const tools = source('components/LibraryViewTools.tsx');
    const css = source('prototype-one-desktop-polish.css');

    expect(screen).toMatch(/desktop-folder-detail-layout/);
    expect(screen).toMatch(/DesktopFolderSummary/);
    expect(summary).toMatch(/Duração total/);
    expect(summary).toMatch(/Disponível offline/);
    expect(summary).toMatch(/Formato predominante/);
    expect(tools).toMatch(/Buscar nesta pasta…/);
    expect(tools).toMatch(/library-folder-quick-filters/);
    expect(css).toMatch(/grid-template-columns: 220px minmax\(0, 1fr\)/);
    expect(css).toMatch(/desktop-folder-detail-main[\s\S]*desktop-library-table__album[\s\S]*display: none/);
  });

  it('usa o mesmo protótipo 2 no detalhe de playlist desktop e neutraliza os controles antigos', () => {
    const screen = source('components/LibraryScreen.tsx');
    const summary = source('components/DesktopPlaylistSummary.tsx');
    const tools = source('components/LibraryViewTools.tsx');
    const css = source('prototype-one-desktop-polish.css');

    expect(screen).toMatch(/desktop-playlist-detail-layout/);
    expect(screen).toMatch(/DesktopPlaylistSummary/);
    expect(summary).toMatch(/Resumo da playlist/);
    expect(summary).toMatch(/Duração total/);
    expect(summary).toMatch(/Disponível offline/);
    expect(tools).toMatch(/Buscar nesta playlist…/);
    expect(tools).toMatch(/collectionDetail/);
    expect(css).toMatch(/desktop-folder-detail-main[\s\S]*search-box--library[\s\S]*opacity: 1/);
    expect(css).toMatch(/desktop-folder-detail-main[\s\S]*library-filter-toggle::after[\s\S]*content: none/);
    expect(css).toMatch(/desktop-playlist-detail-main[\s\S]*collection-actions/);
  });
});
