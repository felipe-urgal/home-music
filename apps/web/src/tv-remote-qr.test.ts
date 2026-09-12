import { describe, expect, it } from 'vitest';
import { buildTvRemoteQrMatrix, tvRemoteQrDataUrl } from './tv-remote-qr';

const pairingUrl = 'https://home-music.tail6ab100.ts.net/remote/123e4567-e89b-12d3-a456-426614174000';

describe('tv remote local QR', () => {
  it('gera a matriz fixa version 10 / M esperada para o endereço de pareamento', () => {
    const matrix = buildTvRemoteQrMatrix(pairingUrl);
    expect(matrix).toHaveLength(57);
    expect(matrix.every(row => row.length === 57)).toBe(true);
    expect(matrix.flat().filter(Boolean)).toHaveLength(1620);
    expect(matrix.slice(0, 7).map(row => row.slice(0, 7))).toEqual([
      [true, true, true, true, true, true, true],
      [true, false, false, false, false, false, true],
      [true, false, true, true, true, false, true],
      [true, false, true, true, true, false, true],
      [true, false, true, true, true, false, true],
      [true, false, false, false, false, false, true],
      [true, true, true, true, true, true, true]
    ]);
  });

  it('gera um data URL SVG local sem incluir o endereço em texto aberto', () => {
    const dataUrl = tvRemoteQrDataUrl(pairingUrl);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml,/);
    expect(dataUrl).not.toContain('123e4567-e89b-12d3-a456-426614174000');
    expect(dataUrl).toContain('%3Csvg');
  });

  it('rejeita endereços maiores que a capacidade protegida do QR', () => {
    expect(() => buildTvRemoteQrMatrix(`https://example.test/${'a'.repeat(214)}`))
      .toThrow(/excede 213 bytes/);
  });
});
