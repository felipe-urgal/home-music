import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveSafeProviderTarget,
  resolveSafeProviderTargets
} from './external-provider-egress-proxy.js';

test('egress do provider aceita somente resolução integralmente pública', async () => {
  const publicTargets = await resolveSafeProviderTargets('media.example.test', async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ]);
  assert.deepEqual(publicTargets, [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ]);

  await assert.rejects(
    () => resolveSafeProviderTargets('mixed.example.test', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]),
    /rede não permitida/i
  );
});

test('egress ordena todos os IPv4 públicos antes de IPv6 e remove duplicatas', async () => {
  const targets = await resolveSafeProviderTargets('dual.example.test', async () => [
    { address: '2606:4700:4700::1111', family: 6 },
    { address: '1.1.1.1', family: 4 },
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 }
  ]);
  assert.deepEqual(targets, [
    { address: '1.1.1.1', family: 4 },
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 }
  ]);
  assert.deepEqual(
    await resolveSafeProviderTarget('dual.example.test', async () => targets),
    { address: '1.1.1.1', family: 4 }
  );
});

test('egress mantém IPv6 quando é a única família pública disponível', async () => {
  const target = await resolveSafeProviderTarget('ipv6.example.test', async () => [
    { address: '2001:4860:4860::8888', family: 6 }
  ]);
  assert.deepEqual(target, { address: '2001:4860:4860::8888', family: 6 });
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
