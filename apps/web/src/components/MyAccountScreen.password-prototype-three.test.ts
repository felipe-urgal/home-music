import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('MyAccountScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-password-v3.css', import.meta.url), 'utf8');
}

describe('MyAccountScreen password prototype 3', () => {
  it('reproduz a composição aprovada no desktop', () => {
    const component = componentSource();

    expect(component).toContain('data-testid="my-account-password-prototype-three"');
    expect(component).toContain('Segurança da conta');
    expect(component).toContain('Alterar senha');
    expect(component).toContain('Mantenha sua conta segura com uma senha forte e única.');
    expect(component).toContain('Requisitos da senha');
    expect(component).toContain('Você será desconectado');
    expect(component).toContain('Sempre com você');
    expect(component).toContain('Música conecta');
  });

  it('mantém o formulário funcional e os quatro requisitos visuais', () => {
    const component = componentSource();

    expect(component).toContain('onSubmit={submitPassword}');
    expect(component).toContain('autoComplete="current-password"');
    expect(component).toContain('autoComplete="new-password"');
    expect(component).toContain('Pelo menos {MIN_ACCOUNT_PASSWORD_CHARACTERS} caracteres');
    expect(component).toContain('Não conter somente espaços');
    expect(component).toContain('Ser diferente da senha atual');
    expect(component).toContain('Confirmar a nova senha corretamente');
  });

  it('usa duas colunas, destaque azul, requisitos verdes e alerta âmbar', () => {
    const css = cssSource();

    expect(css).toContain('grid-template-columns: minmax(0, 1.66fr) minmax(330px, .95fr);');
    expect(css).toContain('.my-account-password-v3__form-card');
    expect(css).toContain('.my-account-password-v3__requirements');
    expect(css).toContain('.my-account-password-v3__warning');
    expect(css).toContain("url('/account-v3-headphones.webp')");
  });
});
