import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSessionClient } from './session-client.js';

test('identifica apenas família de browser e plataforma, sem versão ou fingerprint', () => {
  assert.equal(describeSessionClient('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.22 Safari/537.36'), 'Chrome · Linux');
  assert.equal(describeSessionClient('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/131.0'), 'Edge · Windows');
  assert.equal(describeSessionClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1 Safari/605.1'), 'Safari · iOS');
  assert.equal(describeSessionClient('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0 Chrome/121.0'), 'Samsung Internet · Android');
  assert.equal(describeSessionClient('Mozilla/5.0 (SMART-TV; Linux) AppleWebKit/537.36'), 'TV · Linux');
});

test('descarta headers opacos, longos e valores não textuais', () => {
  assert.equal(describeSessionClient(''), null);
  assert.equal(describeSessionClient('my-secret-custom-fingerprint-id'), null);
  assert.equal(describeSessionClient('a'.repeat(1025)), null);
  assert.equal(describeSessionClient({ userAgent: 'Chrome/10' }), null);
});
