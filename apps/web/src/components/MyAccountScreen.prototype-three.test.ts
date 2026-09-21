import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('MyAccountScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-overview-v3.css', import.meta.url), 'utf8');
}

describe('MyAccountScreen prototype 3', () => {
  it('usa a composição editorial aprovada no overview desktop', () => {
    const component = componentSource();

    expect(component).toContain('my-account-overview--v3');
    expect(component).toContain('Seu som,');
    expect(component).toContain('suas escolhas.');
    expect(component).toContain('O controle é seu');
    expect(component).toContain('my-account-v3__profile-card');
    expect(component).toContain('my-account-v3__headphones');
    expect(component).toContain('my-account-v3__grid');
    expect(component).toContain('my-account-v3__bottom-grid');
    expect(component).toContain('Ouça&nbsp;&nbsp;•&nbsp;&nbsp;Organize');
  });

  it('mantém todos os destinos funcionais do menu', () => {
    const component = componentSource();

    expect(component).toMatch(/setView\('password'\)/);
    expect(component).toMatch(/setView\('sessions'\)/);
    expect(component).toMatch(/setView\('apps'\)/);
    expect(component).toMatch(/setView\('data-import'\)/);
    expect(component).toMatch(/setView\('playback'\)/);
    expect(component).toMatch(/offlineMode\.onOpen/);
    expect(component).toMatch(/onOpenAdministration/);
    expect(component).toMatch(/void signOut\(\)/);
  });

  it('usa toda a largura, três colunas e preserva o overview antigo fora do desktop', () => {
    const css = cssSource();

    expect(css).toMatch(/my-account-screen--overview[\s\S]*width: 100%/);
    expect(css).toMatch(/my-account-v3__grid[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/my-account-v3__bottom-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/my-account-overview--legacy[\s\S]*display: none/);
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*my-account-overview--legacy[\s\S]*display: block/);
  });

  it('reproduz as cores individuais e a decoração musical do conceito', () => {
    const css = cssSource();

    for (const tone of ['is-amber', 'is-blue', 'is-violet', 'is-green', 'is-pink', 'is-cyan', 'is-indigo', 'is-red']) {
      expect(css).toContain(`.my-account-v3__card.${tone}`);
    }
    expect(css).toContain('.my-account-v3__headphones-band');
    expect(css).toContain('.my-account-v3__headphones-cup');
    expect(css).toContain('.my-account-v3__vertical-copy');
  });
});
