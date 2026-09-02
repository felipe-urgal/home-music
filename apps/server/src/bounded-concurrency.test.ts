import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWithConcurrency } from './bounded-concurrency.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

test('mapWithConcurrency limita operações simultâneas e preserva a ordem dos resultados', async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency(
    Array.from({ length: 12 }, (_, index) => index),
    3,
    async value => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    }
  );

  assert.equal(maxActive, 3);
  assert.deepEqual(results, Array.from({ length: 12 }, (_, index) => index * 2));
});

test('mapWithConcurrency espera operações iniciadas terminarem antes de propagar erro', async () => {
  const releaseSecondWorker = deferred();
  const started: number[] = [];
  const finished: number[] = [];

  const operation = mapWithConcurrency([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw new Error('falha controlada');

    await releaseSecondWorker.promise;
    finished.push(value);
    return value;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started.sort((left, right) => left - right), [0, 1]);

  releaseSecondWorker.resolve();
  await assert.rejects(operation, /falha controlada/);
  assert.deepEqual(started.sort((left, right) => left - right), [0, 1]);
  assert.deepEqual(finished, [1]);
});

test('mapWithConcurrency rejeita limite inválido', async () => {
  await assert.rejects(
    () => mapWithConcurrency([1], 0, async value => value),
    /concurrency/i
  );
});
