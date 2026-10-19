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


test('fila de mutações tem limite, métricas de espera e shutdown não perde trabalho aceito', async () => {
  const waits: number[] = [];
  const lock = new LibraryMutationLock({ maxPending: 1, onWait: duration => waits.push(duration) });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const order: string[] = [];
  const first = lock.run(async () => {
    order.push('first:start');
    await gate;
    order.push('first:end');
  });
  await Promise.resolve();
  const second = lock.run(async () => { order.push('second'); });
  await Promise.resolve();
  assert.deepEqual(lock.stats().pending, 1);
  await assert.rejects(lock.run(async () => undefined), /Fila de mutações/);
  release();
  await Promise.all([first, second, lock.waitForIdle()]);
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  assert.deepEqual([lock.stats().active, lock.stats().pending], [0, 0]);
  assert.equal(waits.length, 2);
  assert.ok(waits.every(value => Number.isFinite(value) && value >= 0));
});
