import { describe, expect, it } from 'vitest';
import {
  approvalLocationWithoutToken,
  readTvDeviceApprovalIntent,
  tvDeviceApprovalUrl
} from './tv-device-login-intent';
import { qrMatrixForValue } from './tv-device-login-qr';

const token = 'approval_1234567890123456';

describe('TV device approval intent', () => {
  it('aceita token válido somente na rota dedicada', () => {
    expect(readTvDeviceApprovalIntent({ pathname: '/tv-login', hash: `#${token}` })).toBe(token);
    expect(readTvDeviceApprovalIntent({ pathname: '/', hash: `#${token}` })).toBeNull();
    expect(readTvDeviceApprovalIntent({ pathname: '/tv-login', hash: '#curto' })).toBeNull();
  });

  it('remove somente o fragmento sensível e preserva query não sensível', () => {
    expect(approvalLocationWithoutToken({ pathname: '/tv-login', search: '?source=tv' }))
      .toBe('/tv-login?source=tv');
  });

  it('monta URL de aprovação com token somente no fragmento', () => {
    expect(tvDeviceApprovalUrl('https://music.example', token))
      .toBe(`https://music.example/tv-login#${token}`);
  });
});

describe('QR local', () => {
  it('gera uma matriz quadrada determinística sem serviço externo', () => {
    const first = qrMatrixForValue(`https://music.example/tv-login#${token}`);
    const second = qrMatrixForValue(`https://music.example/tv-login#${token}`);

    expect(first.size).toBeGreaterThan(20);
    expect(first.cells).toHaveLength(first.size);
    expect(first.cells.every(row => row.length === first.size)).toBe(true);
    expect(second).toEqual(first);
  });
});
