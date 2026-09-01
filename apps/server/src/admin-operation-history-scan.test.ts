import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScanResponse } from '@home-music/shared';
import { runScanWithHistory } from './admin-operation-history-scan.js';
import { LongJobObservability } from './long-job-observability.js';

const RESULT: ScanResponse = {
  tracks: 10,
  scannedAt: '2026-08-28T12:00:01.000Z',
  added: 1,
  updated: 2,
  removed: 0,
  unchanged: 7
};

test('registra sucesso sem alterar o resultado do scan', async () => {
  const calls: string[] = [];
  const history = {
    startScan: () => { calls.push('start'); return 'scan-1'; },
    completeScan: (_id: string, result: ScanResponse) => { calls.push(`complete:${result.tracks}`); },
    failScan: () => { calls.push('fail'); }
  };

  const result = await runScanWithHistory(history, 'manual', async () => RESULT);
  assert.equal(result, RESULT);
  assert.deepEqual(calls, ['start', 'complete:10']);
});

test('registra falha e preserva o erro original da operação', async () => {
  const original = new Error('scan falhou');
  let recorded: unknown = null;
  const history = {
    startScan: () => 'scan-2',
    completeScan: () => undefined,
    failScan: (_id: string, error: unknown) => { recorded = error; }
  };

  await assert.rejects(
    runScanWithHistory(history, 'automatic', async () => { throw original; }),
    error => error === original
  );
  assert.equal(recorded, original);
});

test('falha no histórico não impede a operação principal', async () => {
  const failures: unknown[] = [];
  const history = {
    startScan: () => { throw new Error('SQLite indisponível'); },
    completeScan: () => undefined,
    failScan: () => undefined
  };

  const result = await runScanWithHistory(history, 'manual', async () => RESULT, error => failures.push(error));
  assert.equal(result, RESULT);
  assert.equal(failures.length, 1);
});

test('correlaciona eventos estruturados do scan com o operation id persistido', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const times = [
    new Date('2026-09-01T12:00:00.000Z'),
    new Date('2026-09-01T12:00:03.000Z')
  ];
  let cursor = 0;
  const observability = new LongJobObservability({
    info(bindings) { logs.push(bindings as Record<string, unknown>); },
    warn(bindings) { logs.push(bindings as Record<string, unknown>); }
  }, { now: () => times[Math.min(cursor++, times.length - 1)] });
  const history = {
    startScan: () => 'scan-correlated',
    completeScan: () => undefined,
    failScan: () => undefined
  };

  await runScanWithHistory(history, 'automatic', async () => RESULT, undefined, observability);

  assert.deepEqual(logs.map(item => item.event), ['long_job.started', 'long_job.completed']);
  assert.equal(logs[0].jobId, 'scan-correlated');
  assert.equal(logs[0].operationId, 'scan-correlated');
  assert.equal(logs[1].durationMs, 3000);
});
