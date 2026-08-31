import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyProductionReadiness } from './verify-production.mjs';

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

test('retry também cobre erro de conexão sem transformar falha permanente em sucesso', async () => {
  let clock = 0;

  const result = await verifyProductionReadiness({
    timeoutMs: 100,
    intervalMs: 50,
    requestTimeoutMs: 20,
    now: () => clock,
    sleepImpl: async ms => { clock += ms; },
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.lastIssue, 'ECONNREFUSED');
});
