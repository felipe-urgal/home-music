import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import Fastify from 'fastify';
import { HomeMusicDatabase } from './database.js';
import { createServerInfrastructure } from './server-infrastructure.js';
import { closeFastifyWithRuntime, createRuntimeShutdown } from './server-shutdown.js';

test('runtime cleanup is idempotent and always attempts SQLite close after rhythm stop failure', async () => {
  const order: string[] = [];
  const rhythmFailure = new Error('injected rhythm stop failure');
  const cleanup = createRuntimeShutdown({
    stopAutoRescan: () => { order.push('rescan'); },
    beginLibraryShutdown: () => { order.push('begin'); },
    waitForLibraryIdle: async () => { order.push('idle'); throw new Error('already reported scan failure'); },
    stopRhythm: async () => { order.push('rhythm'); throw rhythmFailure; },
    closeInfrastructure: () => { order.push('sqlite'); }
  });

  await assert.rejects(cleanup(), error => error === rhythmFailure);
  await assert.rejects(cleanup(), error => error === rhythmFailure);
  assert.deepEqual(order, ['rescan', 'begin', 'idle', 'rhythm', 'sqlite']);
});

test('Fastify onClose error cannot prevent SQLite cleanup; callbacks run only once', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-fastify-close-fallback-'));
  const app = Fastify({ logger: false });
  try {
    const databasePath = path.join(root, 'home-music.db');
    const infra = createServerInfrastructure({
      databasePath,
      transcodeCachePath: path.join(root, 'cache'),
      transcodeCacheMegabytes: 64,
      ffmpegCommand: 'ffmpeg',
      logger: app.log
    });

    const events: string[] = [];
    const original = HomeMusicDatabase.prototype.close;
    t.mock.method(HomeMusicDatabase.prototype, 'close', function (this: HomeMusicDatabase) {
      events.push('sqlite');
      original.call(this);
    });

    const cleanup = createRuntimeShutdown({
      stopAutoRescan: () => { events.push('rescan'); },
      beginLibraryShutdown: () => { events.push('begin'); },
      waitForLibraryIdle: async () => { events.push('idle'); },
      stopRhythm: async () => { events.push('rhythm'); },
      closeInfrastructure: () => infra.close()
    });

    app.addHook('onClose', async () => {
      events.push('failed-hook');
      throw new Error('injected route shutdown failure');
    });
    app.addHook('onClose', async () => {
      await cleanup();
    });

    await assert.rejects(
      closeFastifyWithRuntime(() => app.close(), cleanup),
      /injected route shutdown failure/
    );
    assert.deepEqual(events.filter(event => event === 'sqlite'), ['sqlite']);
    for (const event of ['rescan', 'begin', 'idle', 'rhythm']) {
      assert.equal(events.filter(item => item === event).length, 1, event);
    }

    const reopened = new DatabaseSync(databasePath);
    try {
      assert.equal(
        (reopened.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
        'ok'
      );
    } finally {
      reopened.close();
    }
    await assert.doesNotReject(cleanup());
  } finally {
    t.mock.restoreAll();
    await rm(root, { recursive: true, force: true });
  }
});

test('Fastify and runtime shutdown both failing preserves both causes, without retrying resources', async () => {
  const calls: string[] = [];
  const fastifyError = new Error('Fastify close failed');
  const runtimeError = new Error('SQLite close failed');

  const cleanup = createRuntimeShutdown({
    stopAutoRescan: () => { calls.push('rescan'); },
    beginLibraryShutdown: () => { calls.push('begin'); },
    waitForLibraryIdle: async () => { calls.push('idle'); },
    stopRhythm: async () => { calls.push('rhythm'); },
    closeInfrastructure: () => { calls.push('sqlite'); throw runtimeError; }
  });
  await assert.rejects(
    closeFastifyWithRuntime(
      async () => { calls.push('fastify'); throw fastifyError; },
      cleanup
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [fastifyError, runtimeError]);
      return true;
    }
  );
  await assert.rejects(cleanup(), error => error === runtimeError);
  assert.deepEqual(calls, ['fastify', 'rescan', 'begin', 'idle', 'rhythm', 'sqlite']);
});
