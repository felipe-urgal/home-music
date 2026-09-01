import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('accessibility contracts', () => {
  it('mantém foco visível, conteúdo apenas para leitor de tela e preferência por movimento reduzido', () => {
    const css = source('accessibility.css');

    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline: 3px solid #67b9ff !important/);
    expect(css).toMatch(/\.sr-only/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/forced-colors:\s*active/);
  });

  it('associa somente erros de credencial aos campos de login', () => {
    const login = source('components/LoginScreen.tsx');
    const requiredPassword = source('components/RequiredPasswordChangeScreen.tsx');

    expect(login).toMatch(/id="login-error"/);
    expect(login).toMatch(/aria-describedby=\{formError \? 'login-error'/);
    expect(login).toMatch(/aria-invalid=\{Boolean\(formError\)\}/);

    expect(requiredPassword).toMatch(/id="password-change-requirements"/);
    expect(requiredPassword).toMatch(/id="password-change-confirmation-error"/);
    expect(requiredPassword).toMatch(/aria-invalid=\{confirmationMismatch\}/);
  });

  it('mantém navegação e estado de reprodução identificáveis sem depender apenas de cor', () => {
    const navigation = source('components/LibraryNavigationChrome.tsx');
    const mobileTracks = source('components/LibraryTrackRows.tsx');
    const desktopTracks = source('components/DesktopTrackTable.tsx');
    const playback = source('components/PlayerPlaybackControls.tsx');

    expect(navigation).toMatch(/aria-current=\{active \? 'page'/);
    expect(mobileTracks).toMatch(/aria-current=\{isCurrent \? 'true'/);
    expect(mobileTracks).toMatch(/reproduzindo agora/);
    expect(desktopTracks).toMatch(/aria-current=\{isCurrent \? 'true'/);
    expect(desktopTracks).toMatch(/reproduzindo agora/);
    expect(playback).toMatch(/aria-pressed=\{repeatMode !== 'off'\}/);
  });

  it('mantém reordenação da fila acessível por botões e com anúncio de resultado', () => {
    const queue = source('components/PlayerQueuePanel.tsx');

    expect(queue).toMatch(/role="status"/);
    expect(queue).toMatch(/aria-atomic="true"/);
    expect(queue).toMatch(/Mover \$\{track\.title\} para cima/);
    expect(queue).toMatch(/Mover \$\{track\.title\} para baixo/);
    expect(queue).toMatch(/movida para a posição/);
  });
});
