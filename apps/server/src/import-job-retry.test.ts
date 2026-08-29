import assert from 'node:assert/strict';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';

test('fila cria retry como novo job e protege lineage contra mutação externa', () => {
  let sequence = 0;
  const queue = new ImportJobQueue({
    createId: () => `job-${++sequence}`,
    now: () => new Date('2026-08-29T15:00:00.000Z')
  });
  const root = queue.enqueue({ type: 'upload', provider: null }, 'faixa.flac');
  queue.transition(root.id, 'failed', 'Falha durante o recebimento do arquivo.');

  const child = queue.enqueue(
    { type: 'upload', provider: null },
    'faixa.flac',
    { parentJobId: root.id, rootJobId: root.id, attempt: 2 }
  );
  assert.notEqual(child.id, root.id);
  assert.deepEqual(child.retry, {
    parentJobId: root.id,
    rootJobId: root.id,
    attempt: 2
  });

  const exposed = child.retry as { parentJobId: string; rootJobId: string; attempt: number };
  exposed.parentJobId = 'alterado';
  exposed.attempt = 99;
  assert.deepEqual(queue.get(child.id)?.retry, {
    parentJobId: root.id,
    rootJobId: root.id,
    attempt: 2
  });
});

test('fila rejeita lineage inconsistente sem criar job', () => {
  const queue = new ImportJobQueue({ createId: () => 'job-invalid' });
  assert.throws(
    () => queue.enqueue(
      { type: 'upload', provider: null },
      'faixa.flac',
      { parentJobId: '', rootJobId: 'root', attempt: 2 }
    ),
    /Vínculo de retry/
  );
  assert.throws(
    () => queue.enqueue(
      { type: 'upload', provider: null },
      'faixa.flac',
      { parentJobId: 'parent', rootJobId: 'root', attempt: 1 }
    ),
    /Vínculo de retry/
  );
  assert.equal(queue.list().length, 0);
});
