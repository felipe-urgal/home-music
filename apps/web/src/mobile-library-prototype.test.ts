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
});
