import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('MyAccountScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-profile-v1.css', import.meta.url), 'utf8');
}

describe('MyAccountScreen profile prototype 1', () => {
  it('usa a composição aprovada no detalhe desktop do perfil', () => {
    const component = componentSource();

    expect(component).toContain('my-account-profile-v1');
    expect(component).toContain('data-testid="my-account-profile-prototype-one"');
    expect(component).toContain('Seus dados, do seu jeito.');
    expect(component).toContain('Boa música');
    expect(component).toContain('vai mais longe.');
    expect(component).toContain('Informações da conta');
    expect(component).toContain('Sua conta está protegida');
    expect(component).toContain('/account-v3-avatar.webp');
  });

  it('mantém ações reais no lugar de controles decorativos', () => {
    const component = componentSource();

    expect(component).toMatch(/onClick={() => setView('password')}/);
    expect(component).toMatch(/onClick={() => setView('sessions')}/);
    expect(component).toMatch(/onClick={goBack}/);
  });

  it('usa largura total, identidade sobre o hero e informações em duas colunas', () => {
    const css = cssSource();

    expect(css).toMatch(/my-account-screen--profile[\s\S]*width: 100%/);
    expect(css).toMatch(/my-account-profile-v1__identity[\s\S]*margin-top: -74px/);
    expect(css).toMatch(/my-account-profile-v1__info-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain("url('/account-v3-headphones.webp')");
    expect(css).toMatch(/my-account-profile-page--legacy[\s\S]*display: none/);
  });

  it('preserva o perfil anterior no mobile e na TV', () => {
    const css = cssSource();

    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*my-account-profile-page--legacy[\s\S]*display: grid/);
    expect(css).toMatch(/html\[data-tv-mode="true"\][\s\S]*my-account-profile-page--legacy[\s\S]*display: grid/);
  });
});
