import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { ImportJob } from '@home-music/shared';
import { LongJobObservability } from './long-job-observability.js';

type CapturedLog = {
  level: 'info' | 'warn';
  bindings: Record<string, unknown>;
  message: string;
};

function captureLogger() {
  const logs: CapturedLog[] = [];
  return {
    logs,
    logger: {
      info(bindings: object, message: string) {
        logs.push({ level: 'info', bindings: bindings as Record<string, unknown>, message });
      },
      warn(bindings: object, message: string) {
        logs.push({ level: 'warn', bindings: bindings as Record<string, unknown>, message });
      }
    }
  };
}

function importJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-42',
    source: { type: 'url', provider: null },
    label: 'Importação',
    status: 'pending',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    mediaDecision: null,
    metadataPreview: null,
    ...overrides
  };
}

test('emite início e conclusão correlacionados com duração', () => {
  const { logger, logs } = captureLogger();
  const times = [
    new Date('2026-09-01T12:00:00.000Z'),
    new Date('2026-09-01T12:00:02.250Z')
  ];
  let cursor = 0;
  const observer = new LongJobObservability(logger, {
    now: () => times[Math.min(cursor++, times.length - 1)],
    createId: () => 'generated-1'
  });

  const run = observer.start({
    jobType: 'library.scan',
    jobId: 'scan-123',
    operationId: 'scan-123'
  });
  observer.complete(run);

  assert.deepEqual(logs.map(item => item.bindings.event), [
    'long_job.started',
    'long_job.completed'
  ]);
  assert.equal(logs[0].bindings.jobType, 'library.scan');
  assert.equal(logs[0].bindings.jobId, 'scan-123');
  assert.equal(logs[0].bindings.operationId, 'scan-123');
  assert.equal(logs[1].bindings.durationMs, 2250);
});

test('propaga requestId por trabalho assíncrono e isola requisições concorrentes', async () => {
  const { logger, logs } = captureLogger();
  const observer = new LongJobObservability(logger);

  await Promise.all([
    observer.withRequest('req-101', async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      const run = observer.start({ jobType: 'library.scan', jobId: 'scan-request-a' });
      await Promise.resolve();
      observer.complete(run);
    }),
    observer.withRequest('req-202', async () => {
      await Promise.resolve();
      const run = observer.start({ jobType: 'transcode', jobId: 'transcode-request-b' });
      await new Promise<void>(resolve => setImmediate(resolve));
      observer.complete(run);
    })
  ]);

  const scanLogs = logs.filter(item => item.bindings.jobId === 'scan-request-a');
  const transcodeLogs = logs.filter(item => item.bindings.jobId === 'transcode-request-b');
  assert.equal(scanLogs.length, 2);
  assert.ok(scanLogs.every(item => item.bindings.requestId === 'req-101'));
  assert.equal(transcodeLogs.length, 2);
  assert.ok(transcodeLogs.every(item => item.bindings.requestId === 'req-202'));

  observer.start({ jobType: 'library.scan', jobId: 'scan-background' });
  const background = logs.find(item => item.bindings.jobId === 'scan-background');
  assert.equal(background && 'requestId' in background.bindings, false);
});

test('preValidation do Fastify mantém requestId até o handler e isola requests simultâneas', async () => {
  const { logger, logs } = captureLogger();
  const observer = new LongJobObservability(logger);
  const app = Fastify();

  app.addHook('preValidation', (request, _reply, done) => {
    observer.withRequest(String(request.id), () => done());
  });
  app.get<{ Params: { jobId: string } }>('/observe/:jobId', async request => {
    await new Promise<void>(resolve => setImmediate(resolve));
    const run = observer.start({ jobType: 'library.scan', jobId: request.params.jobId });
    await Promise.resolve();
    observer.complete(run);
    return { requestId: String(request.id) };
  });

  try {
    const [first, second] = await Promise.all([
      app.inject({ method: 'GET', url: '/observe/job-fastify-a' }),
      app.inject({ method: 'GET', url: '/observe/job-fastify-b' })
    ]);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);

    const firstRequestId = (first.json() as { requestId: string }).requestId;
    const secondRequestId = (second.json() as { requestId: string }).requestId;
    assert.notEqual(firstRequestId, secondRequestId);

    const firstLogs = logs.filter(item => item.bindings.jobId === 'job-fastify-a');
    const secondLogs = logs.filter(item => item.bindings.jobId === 'job-fastify-b');
    assert.equal(firstLogs.length, 2);
    assert.ok(firstLogs.every(item => item.bindings.requestId === firstRequestId));
    assert.equal(secondLogs.length, 2);
    assert.ok(secondLogs.every(item => item.bindings.requestId === secondRequestId));
  } finally {
    await app.close();
  }
});

test('sanitiza erro antes de escrever evento de falha', () => {
  const { logger, logs } = captureLogger();
  const observer = new LongJobObservability(logger, {
    now: () => new Date('2026-09-01T12:00:00.000Z'),
    createId: () => 'generated-2'
  });
  const run = observer.start({ jobType: 'transcode', resourceId: 'track-7' });

  observer.fail(
    run,
    new Error('token=supersecreto https://private.example/media /srv/music/album/faixa.flac')
  );

  const failed = logs.at(-1)?.bindings;
  assert.equal(failed?.event, 'long_job.failed');
  assert.equal(failed?.resourceId, 'track-7');
  assert.doesNotMatch(String(failed?.errorMessage), /supersecreto|private\.example|srv\/music|faixa\.flac/);
  assert.match(String(failed?.errorMessage), /\[redigido\]|\[URL removida\]|\[caminho removido\]/);
  assert.equal('err' in (failed ?? {}), false);
});

test('correlaciona lifecycle da importação sem duplicar início ao retomar processing no mesmo timestamp', () => {
  const { logger, logs } = captureLogger();
  const observer = new LongJobObservability(logger, {
    now: () => new Date('2026-09-01T12:10:00.000Z')
  });

  observer.observeImportJob(importJob(), 'import-job-42');
  observer.observeImportJob(importJob({
    status: 'processing',
    startedAt: '2026-09-01T12:01:00.000Z',
    updatedAt: '2026-09-01T12:01:00.000Z'
  }), 'import-job-42');
  observer.observeImportJob(importJob({
    status: 'pending',
    startedAt: '2026-09-01T12:01:00.000Z',
    updatedAt: '2026-09-01T12:01:00.000Z'
  }), 'import-job-42');
  observer.observeImportJob(importJob({
    status: 'processing',
    startedAt: '2026-09-01T12:01:00.000Z',
    updatedAt: '2026-09-01T12:01:00.000Z'
  }), 'import-job-42');
  observer.observeImportJob(importJob({
    status: 'completed',
    startedAt: '2026-09-01T12:01:00.000Z',
    updatedAt: '2026-09-01T12:06:30.000Z',
    finishedAt: '2026-09-01T12:06:30.000Z'
  }), 'import-job-42');

  assert.deepEqual(logs.map(item => item.bindings.event), [
    'long_job.started',
    'long_job.completed'
  ]);
  assert.equal(logs[0].bindings.jobId, 'job-42');
  assert.equal(logs[0].bindings.operationId, 'import-job-42');
  assert.equal(logs[1].durationMs, 330_000);
});

test('job terminal libera deduplicação para evitar retenção indefinida de ids', () => {
  const { logger, logs } = captureLogger();
  const observer = new LongJobObservability(logger);

  const processing = importJob({
    status: 'processing',
    startedAt: '2026-09-01T12:01:00.000Z',
    updatedAt: '2026-09-01T12:01:00.000Z'
  });
  observer.observeImportJob(processing, 'import-job-42');
  observer.observeImportJob(importJob({
    status: 'cancelled',
    startedAt: processing.startedAt,
    finishedAt: '2026-09-01T12:02:00.000Z',
    updatedAt: '2026-09-01T12:02:00.000Z'
  }), 'import-job-42');
  observer.observeImportJob(processing, 'import-job-42');

  assert.deepEqual(logs.map(item => item.bindings.event), [
    'long_job.started',
    'long_job.cancelled',
    'long_job.started'
  ]);
});

test('falha do sink de log não interfere na operação chamadora', () => {
  const observer = new LongJobObservability({
    info() { throw new Error('logger indisponível'); },
    warn() { throw new Error('logger indisponível'); }
  }, { createId: () => 'fallback' });

  const run = observer.start({ jobType: 'library.scan' });
  assert.doesNotThrow(() => observer.fail(run, new Error('scan falhou')));
});
