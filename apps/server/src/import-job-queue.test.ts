import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ImportJob } from '@home-music/shared';
import {
  HeavyWorkQueueSaturatedError,
  withHeavyWorkRequestContext
} from './heavy-work-queue.js';
import { ImportJobQueue } from './import-job-queue.js';

function deterministicQueue() {
  const timestamps = [
    '2026-08-27T12:00:00.000Z',
    '2026-08-27T12:01:00.000Z',
    '2026-08-27T12:02:00.000Z',
    '2026-08-27T12:03:00.000Z'
  ];
  let id = 0;
  let time = 0;
  return new ImportJobQueue({
    createId: () => `job-${++id}`,
    now: () => new Date(timestamps[Math.min(time++, timestamps.length - 1)])
  });
}

test('cria jobs pendentes e devolve snapshots defensivos', () => {
  const queue = deterministicQueue();
  const created = queue.enqueue({ type: 'upload', provider: null }, '  Album novo  ');

  assert.equal(created.id, 'job-1');
  assert.equal(created.label, 'Album novo');
  assert.equal(created.status, 'pending');
  assert.deepEqual(created.source, { type: 'upload', provider: null });
  assert.equal(created.createdAt, '2026-08-27T12:00:00.000Z');

  created.label = 'alterado fora da fila';
  created.source.type = 'url';
  assert.equal(queue.get('job-1')?.label, 'Album novo');
  assert.deepEqual(queue.get('job-1')?.source, { type: 'upload', provider: null });
});

test('publica snapshots defensivos a cada mudança de estado', () => {
  const observed: ImportJob[] = [];
  let time = 0;
  const timestamps = [
    '2026-08-27T12:00:00.000Z',
    '2026-08-27T12:01:00.000Z',
    '2026-08-27T12:02:00.000Z'
  ];
  const queue = new ImportJobQueue({
    createId: () => 'job-observer',
    now: () => new Date(timestamps[Math.min(time++, timestamps.length - 1)]),
    onChange: job => observed.push(job)
  });

  const created = queue.enqueue({ type: 'upload', provider: null }, 'Arquivo novo');
  queue.transition(created.id, 'processing');
  queue.transition(created.id, 'completed');

  assert.deepEqual(observed.map(job => job.status), ['pending', 'processing', 'completed']);
  assert.equal(observed[1].startedAt, '2026-08-27T12:01:00.000Z');
  assert.equal(observed[2].finishedAt, '2026-08-27T12:02:00.000Z');

  observed[0].label = 'mutação externa';
  observed[0].source.type = 'url';
  assert.equal(queue.get(created.id)?.label, 'Arquivo novo');
  assert.deepEqual(queue.get(created.id)?.source, { type: 'upload', provider: null });
});

test('permite URL voltar de processing para pending quando o staging termina', () => {
  const queue = deterministicQueue();
  const job = queue.enqueue({ type: 'url', provider: null }, 'example.test · audio.flac');

  const processing = queue.transition(job.id, 'processing');
  assert.equal(processing?.status, 'processing');
  assert.equal(processing?.startedAt, '2026-08-27T12:01:00.000Z');

  const pending = queue.transition(job.id, 'pending');
  assert.equal(pending?.status, 'pending');
  assert.equal(pending?.startedAt, '2026-08-27T12:01:00.000Z');
  assert.equal(pending?.finishedAt, null);

  const resumed = queue.transition(job.id, 'processing');
  assert.equal(resumed?.status, 'processing');
  assert.equal(resumed?.startedAt, '2026-08-27T12:01:00.000Z');
});

test('aplica somente transições válidas até estado terminal', () => {
  const queue = deterministicQueue();
  const job = queue.enqueue({ type: 'url', provider: null }, 'https://example.test/audio.flac');

  const processing = queue.transition(job.id, 'processing');
  assert.equal(processing?.status, 'processing');
  assert.equal(processing?.startedAt, '2026-08-27T12:01:00.000Z');
  assert.equal(processing?.finishedAt, null);

  const completed = queue.transition(job.id, 'completed');
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.finishedAt, '2026-08-27T12:02:00.000Z');
  assert.equal(completed?.error, null);

  assert.throws(() => queue.transition(job.id, 'processing'), /Transição de importação inválida/);
});

test('registra falha limitada e exige nome de provider externo', () => {
  const queue = deterministicQueue();

  assert.throws(
    () => queue.enqueue({ type: 'provider', provider: '   ' }, 'Música externa'),
    /Provider de importação obrigatório/
  );

  const job = queue.enqueue({ type: 'provider', provider: '  exemplo  ' }, 'Música externa');
  assert.deepEqual(job.source, { type: 'provider', provider: 'exemplo' });

  const failed = queue.transition(job.id, 'failed', ` ${'x'.repeat(600)} `);
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.error?.length, 500);
  assert.ok(failed?.finishedAt);
});

test('lista jobs mais recentes primeiro e descarta terminais antigos quando necessário', () => {
  let id = 0;
  const queue = new ImportJobQueue({
    maxRetainedJobs: 2,
    createId: () => `job-${++id}`,
    now: () => new Date('2026-08-27T12:00:00.000Z')
  });

  const first = queue.enqueue({ type: 'upload', provider: null }, 'Primeiro');
  queue.transition(first.id, 'cancelled');
  queue.enqueue({ type: 'upload', provider: null }, 'Segundo');
  queue.enqueue({ type: 'url', provider: null }, 'Terceiro');

  assert.deepEqual(queue.list().map(job => job.label), ['Terceiro', 'Segundo']);
});

test('limita jobs não terminais globalmente e por usuário', () => {
  let id = 0;
  const queue = new ImportJobQueue({
    maxNonTerminalJobs: 2,
    maxNonTerminalJobsPerOwner: 1,
    retryAfterSeconds: 7,
    createId: () => `bounded-${++id}`,
    now: () => new Date('2026-08-27T12:00:00.000Z')
  });

  const first = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
    queue.enqueue({ type: 'upload', provider: null }, 'A')
  );
  assert.throws(
    () => withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
      queue.enqueue({ type: 'url', provider: null }, 'A2')
    ),
    (error: unknown) => error instanceof HeavyWorkQueueSaturatedError
      && error.statusCode === 503
      && error.retryAfterSeconds === 7
  );

  withHeavyWorkRequestContext({ ownerId: 'user-b' }, () =>
    queue.enqueue({ type: 'url', provider: null }, 'B')
  );
  assert.throws(
    () => withHeavyWorkRequestContext({ ownerId: 'user-c' }, () =>
      queue.enqueue({ type: 'url', provider: null }, 'C')
    ),
    HeavyWorkQueueSaturatedError
  );
  assert.equal(queue.runtime.pending, 2);
  assert.equal(queue.runtime.rejected, 2);

  queue.transition(first.id, 'completed');
  const replacement = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () =>
    queue.enqueue({ type: 'upload', provider: null }, 'A3')
  );
  assert.equal(replacement.status, 'pending');
});
