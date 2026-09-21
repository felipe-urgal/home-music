import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('AccountOpenSubsonicKeys.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-apps-v2.css', import.meta.url), 'utf8');
}

describe('AccountOpenSubsonicKeys prototype 2', () => {
  it('reproduz a composição aprovada', () => {
    const component = componentSource();

    expect(component).toContain('data-testid="account-apps-prototype-two"');
    expect(component).toContain('Minha conta');
    expect(component).toContain('Apps e integrações');
    expect(component).toContain('Conecte seus apps e serviços favoritos ao Home Music.');
    expect(component).toContain('Nova chave de aplicativo');
    expect(component).toContain('Crie uma credencial separada para cada cliente OpenSubsonic.');
    expect(component).toContain('Aplicativos autorizados');
    expect(component).toContain('Ativo');
    expect(component).toContain('Revogar');
  });

  it('mantém as ações reais de criar, copiar e revogar', () => {
    const component = componentSource();

    expect(component).toContain('onSubmit={submit}');
    expect(component).toContain('onClick={() => void copyToken()}');
    expect(component).toContain('onClick={() => void revoke(key)}');
    expect(component).toContain('API key OpenSubsonic recém-criada');
  });

  it('usa toda a largura e mantém input e ação na mesma linha', () => {
    const css = cssSource();

    expect(css).toContain('width: 100%;');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 212px;');
    expect(css).toContain('min-height: 84px;');
    expect(css).toContain('clip-path: polygon(48% 0, 100% 0, 100% 100%, 0 100%);');
    expect(css).toContain('gap: 28px;');
    expect(css).toContain('.account-apps-v2__create');
    expect(css).toContain('.account-apps-v2__authorized');
    expect(css).toContain('.account-apps-v2__status');
    expect(css).toContain('linear-gradient(180deg, #714cff, #562fe0)');
  });

  it('preserva o layout legado quando o protótipo desktop não está ativo', () => {
    const component = componentSource();

    expect(component).toContain('if (prototypeTwo)');
    expect(component).toContain('className="my-account-card"');
    expect(component).toContain('my-account-session-list');
  });
});
