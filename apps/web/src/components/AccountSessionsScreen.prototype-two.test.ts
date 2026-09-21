import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource() {
  return readFileSync(new URL('AccountSessionsScreen.tsx', import.meta.url), 'utf8');
}

function cssSource() {
  return readFileSync(new URL('../account-sessions-v2.css', import.meta.url), 'utf8');
}

describe('AccountSessionsScreen prototype 2', () => {
  it('reproduz a estrutura aprovada de lista e detalhe', () => {
    const component = componentSource();

    expect(component).toContain('data-testid="account-sessions-prototype-two"');
    expect(component).toContain('Sessões em dispositivos');
    expect(component).toContain('Mantenha sua conta protegida');
    expect(component).toContain('Todas (');
    expect(component).toContain('Outras (');
    expect(component).toContain('Este dispositivo (');
    expect(component).toContain('Informações da sessão');
    expect(component).toContain('Esta é a sua sessão atual');
    expect(component).toContain('Detalhes do dispositivo');
  });

  it('mantém as ações reais do fluxo de sessões', () => {
    const component = componentSource();

    expect(component).toContain('onClick={onRefresh}');
    expect(component).toContain('onClick={onRevokeOthers}');
    expect(component).toContain('onClick={() => onRevokeOne(selectedSession)}');
    expect(component).toContain('Encerrar outras sessões');
    expect(component).toContain('Encerrar esta sessão');
  });

  it('usa duas colunas e detalhe persistente como no protótipo', () => {
    const css = cssSource();

    expect(css).toContain('grid-template-columns: minmax(320px, .72fr) minmax(0, 1.58fr);');
    expect(css).toContain('.account-sessions-v2__sidebar');
    expect(css).toContain('.account-sessions-v2__detail');
    expect(css).toContain('.account-sessions-v2__metrics');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(css).toContain('.account-sessions-v2__laptop');
  });

  it('mantém o layout expansível anterior disponível fora do desktop', () => {
    const component = componentSource();

    expect(component).toContain('if (prototypeTwo)');
    expect(component).toContain('className="account-sessions-screen"');
    expect(component).toContain('account-session-card');
  });
});
