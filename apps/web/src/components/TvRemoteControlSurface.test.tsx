import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TvRemoteControlSurface.tsx', import.meta.url), 'utf8');

describe('TvRemoteControlSurface direct transfer status', () => {
  it('não mantém banner de downloads apenas porque o peer está aberto e ocioso', () => {
    expect(source).not.toContain("transferState !== 'idle' || peerState === 'open' || statusText !== null");
    expect(source).not.toContain("peerState === 'open' ? 'Áudio direto pronto para seus downloads.' : null");
    expect(source).toContain("transferState !== 'idle' || statusText !== null");
  });

  it('preserva mensagens contextuais de envio, sucesso e erro', () => {
    expect(source).toContain('Enviando música baixada para a TV…');
    expect(source).toContain('Música enviada diretamente do celular.');
    expect(source).toContain('A conexão direta com a TV falhou.');
    expect(source).toContain('Não foi possível enviar a música para a TV.');
  });
});
