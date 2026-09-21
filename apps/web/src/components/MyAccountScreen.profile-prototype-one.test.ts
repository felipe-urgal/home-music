import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('MyAccountScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-profile-v1.css', import.meta.url), 'utf8');
}

describe('MyAccountScreen profile prototype 1', () => {
  it('reproduz os textos e blocos do protótipo 1 aprovado', () => {
    const component = componentSource();

    expect(component).toContain('data-testid="my-account-profile-prototype-one"');
    expect(component).toContain('Seu perfil');
    expect(component).toContain('Suas informações, do seu jeito.');
    expect(component).toContain('Boa música');
    expect(component).toContain('vai mais longe.');
    expect(component).toContain('Informações da conta');
    expect(component).toContain('Seus dados básicos no Home Music.');
    expect(component).toContain('Nome de usuário');
    expect(component).toContain('Seu identificador na aplicação.');
    expect(component).toContain('Tipo de conta');
    expect(component).toContain('Seu nível de acesso e permissões.');
    expect(component).toContain('Segurança da conta');
    expect(component).toContain('Mantenha sua conta segura.');
    expect(component).toContain('Sua conta está protegida');
    expect(component).toContain('O controle é seu.');
  });

  it('mantém as ações reais existentes e não inventa edição de dados', () => {
    const component = componentSource();

    expect(component).toContain('onClick={goBack}');
    expect(component).toContain('className="my-account-profile-v1__security-action"');
    expect(component).toContain("onClick={() => setView('password')}");
    expect(component).toContain('<Pencil /> Editar');
    expect(component).toContain('<ShieldCheck /> Detalhes');
  });

  it('usa a geometria do mockup: hero curto, conteúdo amplo e linhas empilhadas', () => {
    const css = cssSource();

    expect(css).toContain('.my-account-screen--profile {');
    expect(css).toContain('width: 100%;');
    expect(css).toContain('.my-account-profile-v1__hero {');
    expect(css).toContain('min-height: 205px;');
    expect(css).toContain('.my-account-profile-v1__identity {');
    expect(css).toContain('min-height: 118px;');
    expect(css).toContain('.my-account-profile-v1__row {');
    expect(css).toContain('grid-template-columns: 48px minmax(260px, 1fr) minmax(120px, auto) 110px;');
    expect(css).toContain("url('/profile-v1-headphones.webp')");
    expect(css).toContain('.my-account-profile-page--legacy {');
    expect(css).toContain('display: none;');
  });

  it('preserva o perfil anterior no mobile e na TV', () => {
    const css = cssSource();

    expect(css).toContain('@media (max-width: 1023px)');
    expect(css).toContain('html[data-tv-mode="true"] .my-account-profile-v1');
    expect(css).toContain('html[data-tv-mode="true"] .my-account-profile-page--legacy');
    expect(css).toContain('display: grid !important;');
  });
});
