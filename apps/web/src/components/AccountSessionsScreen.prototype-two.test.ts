import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('AccountSessionsScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-sessions-v2.css', import.meta.url), 'utf8');
}

describe('AccountSessionsScreen prototype 2', () => {
  it('reproduz a estrutura do protótipo 2 aprovado', () => {
    const component = componentSource();

    expect(component).toContain('data-testid="account-sessions-prototype-two"');
    expect(component).toContain('Minha conta');
    expect(component).toContain('Ajuda');
    expect(component).toContain('Outros dispositivos');
    expect(component).toContain('Gerencie as sessões ativas da sua conta.');
    expect(component).toContain('Mantenha sua conta segura');
    expect(component).toContain('Se não reconhecer um dispositivo, encerre a sessão.');
    expect(component).toContain('Sessões ativas');
    expect(component).toContain('Este dispositivo');
    expect(component).toContain('Atual');
    expect(component).toContain('Ativo agora');
    expect(component).toContain('Encerrar todas as outras sessões');
    expect(component).toContain('Isso não afetará este dispositivo.');
  });

  it('mantém as ações reais sem inventar metadados de dispositivo', () => {
    const component = componentSource();

    expect(component).toContain('onClick={onBack}');
    expect(component).toContain('onClick={onRevokeOthers}');
    expect(component).toContain('onRevokeOne(session)');
    expect(component).toContain('Dispositivo conectado');
    expect(component).toContain('ID {session.id.slice(0, 8)}');
    expect(component).not.toContain('Ubuntu Desktop');
    expect(component).not.toContain('Galaxy S23');
    expect(component).not.toContain('Windows PC');
  });

  it('usa largura ampla, tema escuro e cards distribuídos no desktop', () => {
    const css = cssSource();

    expect(css).toContain('width: calc(100% - 36px);');
    expect(css).toContain('min-height: calc(100vh - 92px);');
    expect(css).toContain('linear-gradient(145deg, #08111d 0%, #091522 52%, #070d16 100%)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('.account-sessions-v2__card.is-current');
    expect(css).toContain('grid-column: 1 / -1;');
    expect(css).toContain('.account-sessions-v2__device');
    expect(css).toContain('.account-sessions-v2__revoke-all');
    expect(css).not.toContain('#f7f7f9');
    expect(css).not.toContain('width: min(calc(100% - 48px), 760px);');
  });

  it('mantém o layout expansível anterior disponível fora do desktop', () => {
    const component = componentSource();

    expect(component).toContain('if (prototypeTwo)');
    expect(component).toContain('className="account-sessions-screen"');
    expect(component).toContain('account-session-card');
  });
});
