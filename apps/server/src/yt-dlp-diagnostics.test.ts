import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyYtDlpFailure } from './yt-dlp-provider.js';

const cases = [
  [
    'ERROR: Unable to connect to proxy http://127.0.0.1:1234: 502 Bad Gateway token=secret',
    'provider_network_failed',
    'O provider externo não conseguiu acessar a origem pela rede segura.'
  ],
  [
    'ERROR: Sign in to confirm you’re not a bot. Use --cookies-from-browser',
    'provider_auth_required',
    'A origem exige autenticação e não pode ser importada sem credenciais.'
  ],
  [
    'WARNING: No supported JavaScript runtime could be found. JS Challenge Providers unavailable',
    'provider_runtime_missing',
    'O yt-dlp não encontrou o runtime JavaScript necessário para esta origem.'
  ],
  [
    'Usage: yt-dlp [OPTIONS] URL\nyt-dlp: error: no such option: --js-runtimes',
    'provider_incompatible',
    'A versão instalada do yt-dlp não é compatível com o provider.'
  ]
] as const;

for (const [stderr, code, message] of cases) {
  test(`stderr conhecido vira ${code}`, () => {
    const error = classifyYtDlpFailure(stderr);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.equal(error.message.includes('token=secret'), false);
    assert.equal(error.message.includes('127.0.0.1'), false);
  });
}

test('stderr desconhecido continua genérico', () => {
  const error = classifyYtDlpFailure('ERROR: detalhe arbitrário segredo=123');
  assert.equal(error.code, 'provider_failed');
  assert.equal(error.message, 'O yt-dlp não conseguiu adquirir a mídia.');
  assert.equal(error.message.includes('segredo=123'), false);
});
