import Fastify from 'fastify';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  registerOpenSubsonicProtocolGuard,
  validateOpenSubsonicCommonParameters
} from './open-subsonic-protocol.js';

describe('validateOpenSubsonicCommonParameters', () => {
  it('exige v e c', () => {
    assert.deepEqual(validateOpenSubsonicCommonParameters({ c: 'symfonium' }), {
      ok: false,
      code: 10,
      message: 'Parâmetros obrigatórios ausentes. Informe v e c.'
    });
    assert.deepEqual(validateOpenSubsonicCommonParameters({ v: '1.16.1' }), {
      ok: false,
      code: 10,
      message: 'Parâmetros obrigatórios ausentes. Informe v e c.'
    });
  });

  it('aceita versões 1.x até a versão anunciada pelo servidor', () => {
    assert.equal(validateOpenSubsonicCommonParameters({ v: '1.15.0', c: 'feishin' }).ok, true);
    assert.equal(validateOpenSubsonicCommonParameters({ v: '1.16.1', c: 'symfonium' }).ok, true);
  });

  it('orienta atualizar o servidor quando o cliente usa protocolo mais novo', () => {
    assert.deepEqual(validateOpenSubsonicCommonParameters({ v: '1.16.2', c: 'client' }), {
      ok: false,
      code: 30,
      message: 'Versão do protocolo incompatível. O servidor precisa ser atualizado.'
    });
    assert.deepEqual(validateOpenSubsonicCommonParameters({ v: '2.0.0', c: 'client' }), {
      ok: false,
      code: 30,
      message: 'Versão do protocolo incompatível. O servidor precisa ser atualizado.'
    });
  });

  it('orienta atualizar o cliente para major antigo ou versão malformada', () => {
    assert.deepEqual(validateOpenSubsonicCommonParameters({ v: '0.9.0', c: 'client' }).ok, false);
    assert.deepEqual(validateOpenSubsonicCommonParameters({ v: 'latest', c: 'client' }).ok, false);
  });

  it('normaliza identificador do cliente e rejeita identificador vazio ou excessivo', () => {
    assert.deepEqual(validateOpenSubsonicCommonParameters({ v: '1.16.1', c: '  Symfonium\u0000 mobile  ' }), {
      ok: true,
      version: '1.16.1',
      client: 'Symfonium mobile'
    });
    assert.equal(validateOpenSubsonicCommonParameters({ v: '1.16.1', c: ' '.repeat(3) }).ok, false);
    assert.equal(validateOpenSubsonicCommonParameters({ v: '1.16.1', c: 'x'.repeat(121) }).ok, false);
  });
});

describe('registerOpenSubsonicProtocolGuard', () => {
  it('mantém getOpenSubsonicExtensions público e bloqueia método normal sem v/c', async () => {
    const app = Fastify();
    registerOpenSubsonicProtocolGuard(app);
    app.get('/rest/:endpoint', async () => ({ reached: true }));

    try {
      const extensions = await app.inject({ method: 'GET', url: '/rest/getOpenSubsonicExtensions.view' });
      assert.equal(extensions.statusCode, 200);
      assert.deepEqual(extensions.json(), { reached: true });

      const ping = await app.inject({ method: 'GET', url: '/rest/ping.view' });
      assert.equal(ping.statusCode, 200);
      assert.equal(ping.json()['subsonic-response'].status, 'failed');
      assert.equal(ping.json()['subsonic-response'].error.code, 10);
    } finally {
      await app.close();
    }
  });

  it('permite método normal quando a versão é compatível', async () => {
    const app = Fastify();
    registerOpenSubsonicProtocolGuard(app);
    app.get('/rest/:endpoint', async () => ({ reached: true }));

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/rest/ping.view?v=1.16.1&c=home-music-tests'
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { reached: true });
    } finally {
      await app.close();
    }
  });
});
