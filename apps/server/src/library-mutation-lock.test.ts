import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryMutationLock } from './library-mutation-lock.js';

test('serializa mutações da biblioteca sem sobreposição', async () => {
  const lock = new LibraryMutationLock();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve;
  });

  const first = lock.run(async () => {
    order.push('first:start');
    await firstGate;
    order.push('first:end');
  });
  const second = lock.run(async () => {
    order.push('second:start');
    order.push('second:end');
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('libera a fila mesmo quando uma mutação falha', async () => {
  const lock = new LibraryMutationLock();

  await assert.rejects(
    () => lock.run(async () => {
      throw new Error('falha esperada');
    }),
    /falha esperada/
  );

  const result = await lock.run(async () => 'ok');
  assert.equal(result, 'ok');
});
