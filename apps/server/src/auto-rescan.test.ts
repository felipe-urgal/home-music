import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS,
  MAX_AUTO_RESCAN_INTERVAL_SECONDS,
  MIN_AUTO_RESCAN_INTERVAL_SECONDS,
  parseAutoRescanIntervalSeconds,
  startAutoRescanScheduler
} from './auto-rescan.js';

test('parseAutoRescanIntervalSeconds usa padrão, permite desligar e valida limites', () => {
  assert.equal(parseAutoRescanIntervalSeconds(undefined), DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS);
  assert.equal(parseAutoRescanIntervalSeconds(''), DEFAULT_AUTO_RESCAN_INTERVAL_SECONDS);
  assert.equal(parseAutoRescanIntervalSeconds('0'), 0);
  assert.equal(parseAutoRescanIntervalSeconds(String(MIN_AUTO_RESCAN_INTERVAL_SECONDS)), MIN_AUTO_RESCAN_INTERVAL_SECONDS);
  assert.equal(parseAutoRescanIntervalSeconds(String(MAX_AUTO_RESCAN_INTERVAL_SECONDS)), MAX_AUTO_RESCAN_INTERVAL_SECONDS);

  assert.throws(() => parseAutoRescanIntervalSeconds('abc'));
  assert.throws(() => parseAutoRescanIntervalSeconds('1.5'));
  assert.throws(() => parseAutoRescanIntervalSeconds(String(MIN_AUTO_RESCAN_INTERVAL_SECONDS - 1)));
  assert.throws(() => parseAutoRescanIntervalSeconds(String(MAX_AUTO_RESCAN_INTERVAL_SECONDS + 1)));
});

test('scheduler espera o delay inicial, não sobrepõe execuções e agenda novamente após concluir', async () => {
  type FakeTimer = {
    callback: () => void;
    delayMs: number;
    cleared: boolean;
    unref: () => void;
  };

  const timers: FakeTimer[] = [];
  const cleared: FakeTimer[] = [];
  let runs = 0;
  let releaseRun: (() => void) | undefined;

  const clock = {
    setTimeout(callback: () => void, delayMs: number) {
      const timer: FakeTimer = {
        callback,
        delayMs,
        cleared: false,
        unref() {}
      };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle: ReturnType<typeof setTimeout>) {
      const timer = handle as unknown as FakeTimer;
      timer.cleared = true;
      cleared.push(timer);
    }
  };

  const stop = startAutoRescanScheduler({
    intervalMs: 60_000,
    initialDelayMs: 15_000,
    clock,
    run: async () => {
      runs += 1;
      await new Promise<void>(resolve => { releaseRun = resolve; });
    }
  });

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 15_000);

  timers[0].callback();
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(timers.length, 1, 'não deve agendar novo timer enquanto o scan ainda está rodando');

  releaseRun?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delayMs, 60_000);

  stop();
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0], timers[1]);
});

test('scheduler continua depois de erro e reporta a falha', async () => {
  type FakeTimer = { callback: () => void; delayMs: number; unref: () => void };
  const timers: FakeTimer[] = [];
  const errors: unknown[] = [];

  const clock = {
    setTimeout(callback: () => void, delayMs: number) {
      const timer: FakeTimer = { callback, delayMs, unref() {} };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout() {}
  };

  const stop = startAutoRescanScheduler({
    intervalMs: 60_000,
    initialDelayMs: 1_000,
    clock,
    run: async () => { throw new Error('falha transitória'); },
    onError: error => errors.push(error)
  });

  timers[0].callback();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(errors.length, 1);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delayMs, 60_000);
  stop();
});
