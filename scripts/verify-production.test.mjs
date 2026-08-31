import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatReadinessSuccess,
  positiveInteger,
  readinessErrorDiagnostic,
  verifyProductionReadiness
} from './verify-production.mjs';

function okResponse(status = 200) {
  return { ok: status >= 200 && status < 300, status };
}

test('confirma readiness quando a aplicação fica pronta após algumas tentativas', async () => {
  let calls = 0;
  let clock = 0;

  const result = await verifyProductionReadiness({
    timeoutMs: 5_000,
    intervalMs: 100,
    requestTimeoutMs: 500,
    now: () => clock,
    sleepImpl: async ms => { clock += ms; },
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? okResponse(503) : okResponse(200);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  assert.equal(result.lastIssue, null);
});

test('mensagem de sucesso não inclui a URL consultada', () => {
  const message = formatReadinessSuccess({ attempts: 2, elapsedMs: 1500 });

  assert.equal(message, 'Readiness de produção confirmado em 2 tentativa(s) após 1500 ms.');
  assert.doesNotMatch(message, /https?:\/\//);
});

test('diagnóstico de erro não repassa URL ou credencial do fetch', () => {
  const secretUrl = 'https://user:secret@example.com/ready?token=abc';
  const diagnostic = readinessErrorDiagnostic(
    new TypeError(`Failed to parse URL from ${secretUrl}`)
  );

  assert.equal(diagnostic, 'falha ao consultar readiness');
  assert.equal(diagnostic.includes(secretUrl), false);
  assert.equal(diagnostic.includes('secret'), false);
});

test('diagnóstico preserva apenas código seguro da causa de conexão', () => {
  const diagnostic = readinessErrorDiagnostic(
    new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
  );

  assert.equal(diagnostic, 'falha de conexão (ECONNREFUSED)');
});

test('override numérico precisa ser inteiro decimal positivo completo', () => {
  assert.equal(positiveInteger('30000', 10), 30000);
  assert.equal(positiveInteger(' 30000 ', 10), 30000);
  assert.equal(positiveInteger('30s', 30000), 30000);
  assert.equal(positiveInteger('30_000', 30000), 30000);
  assert.equal(positiveInteger('0', 30000), 30000);
  assert.equal(positiveInteger('-1', 30000), 30000);
});

test('falha de forma bounded quando readiness não fica disponível', async () => {
  let calls = 0;
  let clock = 0;

  const result = await verifyProductionReadiness({
    timeoutMs: 250,
    intervalMs: 100,
    requestTimeoutMs: 50,
    now: () => clock,
    sleepImpl: async ms => { clock += ms; },
    fetchImpl: async () => {
      calls += 1;
      return okResponse(503);
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 4);
  assert.equal(calls, 4);
  assert.equal(result.lastIssue, 'HTTP 503');
  assert.equal(result.elapsedMs, 250);
});

test('retry cobre erro de conexão sem transformar falha permanente em sucesso', async () => {
  let clock = 0;

  const result = await verifyProductionReadiness({
    timeoutMs: 100,
    intervalMs: 50,
    requestTimeoutMs: 20,
    now: () => clock,
    sleepImpl: async ms => { clock += ms; },
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.lastIssue, 'falha de conexão (ECONNREFUSED)');
});
