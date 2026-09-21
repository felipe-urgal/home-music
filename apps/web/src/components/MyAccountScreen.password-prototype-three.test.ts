import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('MyAccountScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-password-v3.css', import.meta.url), 'utf8');
}

describe('MyAccountScreen password prototype 3', () => {
  it('reproduz o card central aprovado', () => {
    const component = componentSource();

    expect(component).toContain('data-testid="my-account-password-prototype-three"');
    expect(component).toContain('Minha conta');
    expect(component).toContain('Ajuda');
    expect(component).toContain('Alterar senha');
    expect(component).toContain('Escolha uma nova senha forte e segura.');
    expect(component).toContain('Força da senha');
    expect(component).toContain('Dicas para uma senha segura');
    expect(component).toContain('Suas informações estão protegidas');
    expect(component).toContain('Usamos criptografia para manter sua conta segura.');
  });

  it('mantém três campos com controle de visibilidade e força da senha', () => {
    const component = componentSource();

    expect(component).toContain('Digite sua senha atual');
    expect(component).toContain('Digite sua nova senha');
    expect(component).toContain('Digite novamente sua nova senha');
    expect(component).toContain('Mostrar senha atual');
    expect(component).toContain('Mostrar nova senha');
    expect(component).toContain('Mostrar confirmação da senha');
    expect(component).toContain('passwordStrengthScore');
    expect(component).toContain('Ótimo! Sua senha está forte.');
  });

  it('mantém a política escolhida de seis caracteres nas dicas', () => {
    const component = componentSource();

    expect(component).toContain('Use pelo menos {MIN_ACCOUNT_PASSWORD_CHARACTERS} caracteres');
    expect(component).toContain('Combine letras, números e símbolos');
    expect(component).toContain('Evite informações pessoais óbvias');
  });

  it('escala o protótipo para ocupar a largura da tela sem perder a composição', () => {
    const css = cssSource();

    expect(css).toContain('width: calc(100% - 36px);');
    expect(css).toContain('width: calc(100% - 64px);');
    expect(css).toContain('border-radius: 16px;');
    expect(css).toContain('.my-account-password-v3__lock');
    expect(css).toContain('linear-gradient(145deg, #7653ea, #5a32cf)');
    expect(css).toContain('.my-account-password-v3__form-card');
    expect(css).toContain('.my-account-password-v3__tips');
    expect(css).toContain('.my-account-password-v3__submit');
    expect(css).toContain('.my-account-password-v3__strength.is-weak');
    expect(css).toContain('.my-account-password-v3__strength.is-medium');
    expect(css).toContain('.my-account-password-v3__strength.is-strong');
    expect(css).not.toContain('width: min(100% - 48px, 570px);');
  });
});
