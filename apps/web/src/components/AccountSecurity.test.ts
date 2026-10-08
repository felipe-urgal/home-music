import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountSession } from '../account-client';
import { AccountSessionsScreen } from './AccountSessionsScreen';
import { ActionDialog } from './ActionDialog';

const sessionBase = {
  createdAt: Date.UTC(2026, 9, 1),
  lastSeenAt: Date.UTC(2026, 9, 2),
  expiresAt: Date.UTC(9999, 11, 31)
};

const sessions: AccountSession[] = [
  { ...sessionBase, id: 'current123456789', current: true, clientName: 'Chrome · Linux' },
  { ...sessionBase, id: 'other123456789', current: false, clientName: 'Firefox · Windows' },
  { ...sessionBase, id: 'legacy123456789', current: false, clientName: null }
];

describe('Minha Conta: ações sensíveis', () => {
  it('usa um único ActionDialog para senha e revogações, sem confirmação nativa', () => {
    const source = readFileSync(new URL('MyAccountScreen.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('window.confirm(');
    expect(source).toContain("openSensitiveAction({ kind: 'password' })");
    expect(source).toContain("openSensitiveAction({ kind: 'others' })");
    expect(source).toContain("openSensitiveAction({ kind: 'one', session })");
    expect(source).toContain('mutationInFlight.current');
    expect(source).toContain('<ActionDialog');
  });

  it('componente de confirmação distingue perigo, erro e bloqueio de mutação', () => {
    const markup = renderToStaticMarkup(createElement(ActionDialog, {
      open: true,
      title: 'Encerrar sessão',
      description: 'A sessão será encerrada.',
      confirmLabel: 'Confirmar',
      danger: true,
      busy: true,
      error: 'Falha de teste',
      onConfirm: () => undefined,
      onClose: () => undefined
    }));
    expect(markup).toContain('is-danger');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Falha de teste');
    expect(markup).toContain('Aguarde');
    expect(markup).toContain('disabled');
    expect(markup).toContain('Cancelar');
  });

  it('retorno de foco e fechamento por Escape respeitam mutações pendentes', () => {
    const source = readFileSync(new URL('ActionDialog.tsx', import.meta.url), 'utf8');
    expect(source).toContain('returnFocusRef');
    expect(source).toContain('previous.focus()');
    expect(source).toContain('if (!busy) onClose()');
    expect(source).toContain('if (!busy && !confirmDisabled) onConfirm()');
    const css = readFileSync(new URL('ActionDialog.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/\.action-dialog\s*\{\s*display:\s*none;/);
  });
});

describe('Minha Conta: sessões identificáveis e fallback', () => {
  for (const prototypeTwo of [true, false]) {
    it(`mostra nome, fallback, atividade, criação e diagnóstico no layout ${prototypeTwo ? 'desktop' : 'mobile'}`, () => {
      const markup = renderToStaticMarkup(createElement(AccountSessionsScreen, {
        sessions,
        loading: false,
        busySessionId: null,
        revokingAll: false,
        prototypeTwo,
        onRevokeOne: () => undefined,
        onRevokeOthers: () => undefined
      }));
      expect(markup).toContain('Este dispositivo');
      expect(markup).toContain('Firefox · Windows');
      expect(markup).toContain('Dispositivo não identificado');
      expect(markup).toContain('Última atividade');
      expect(markup).toContain('other12');
      expect(markup).not.toContain('Outra sessão 1');
    });
  }
});
