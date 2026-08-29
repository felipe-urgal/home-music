import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSafeProviderTarget } from './external-provider-egress-proxy.js';

test('egress do provider aceita somente resolução integralmente pública', async () => {
  const publicTarget = await resolveSafeProviderTarget('media.example.test', async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ]);
  assert.deepEqual(publicTarget, { address: '8.8.8.8', family: 4 });

  await assert.rejects(
    () => resolveSafeProviderTarget('mixed.example.test', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]),
    /rede não permitida/i
  );
});

test('egress do provider bloqueia loopback, redes privadas, metadata e hostnames locais', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1', 'fe80::1']) {
    await assert.rejects(
      () => resolveSafeProviderTarget(address, async host => [{ address: host, family: host.includes(':') ? 6 : 4 }]),
      /rede não permitida/i,
      address
    );
  }

  for (const hostname of ['localhost', 'service.local', 'metadata.internal']) {
    let resolved = false;
    await assert.rejects(
      () => resolveSafeProviderTarget(hostname, async () => {
        resolved = true;
        return [{ address: '8.8.8.8', family: 4 }];
      }),
      /rede não permitida/i
    );
    assert.equal(resolved, false, hostname);
  }
});
