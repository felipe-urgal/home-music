import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HeavyWorkQueueSaturatedError } from './heavy-work-queue.js';
import {
  TranscodeCacheBusyError,
  TranscodeCacheMaintenance,
  UnsafeTranscodeCacheDirectoryError
} from './transcode-cache-maintenance.js';

const CACHE_A = `${'a'.repeat(64)}.m4a`;
const CACHE_B = `${'b'.repeat(64)}.m4a`;
const TEMP = `${'c'.repeat(64)}.m4a.tmp-12345678-abcd-1234-abcd-123456789abc`;

test('status conta somente arquivos reconhecidos do cache e preserva limite/runtime', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-cache-status-'));
  try {
    await writeFile(path.join(cacheDir, CACHE_A), Buffer.alloc(40));
    await writeFile(path.join(cacheDir, TEMP), Buffer.alloc(10));
    await writeFile(path.join(cacheDir, 'nao-remover.txt'), Buffer.alloc(99));

    const maintenance = new TranscodeCacheMaintenance({
      cacheDir,
      limitBytes: 512,
      runtime: () => ({ active: 1, pending: 2 })
    });

    assert.deepEqual(await maintenance.status(), {
      bytes: 50,
      limitBytes: 512,
      entries: 1,
      temporaryEntries: 1,
      active: 1,
      pending: 2
    });
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('clear remove cache final e temporário sem apagar arquivos desconhecidos', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-cache-clear-'));
  try {
    await writeFile(path.join(cacheDir, CACHE_A), Buffer.alloc(40));
    await writeFile(path.join(cacheDir, CACHE_B), Buffer.alloc(30));
    await writeFile(path.join(cacheDir, TEMP), Buffer.alloc(10));
    await writeFile(path.join(cacheDir, 'nao-remover.txt'), 'preservado');

    const maintenance = new TranscodeCacheMaintenance({
      cacheDir,
      limitBytes: 512,
      runtime: () => ({ active: 0, pending: 0 })
    });

    const result = await maintenance.clear();
    assert.equal(result.freedBytes, 80);
    assert.equal(result.removedEntries, 3);
    assert.equal(result.failedEntries, 0);
    assert.deepEqual(result.cache, {
      bytes: 0,
      limitBytes: 512,
      entries: 0,
      temporaryEntries: 0,
      active: 0,
      pending: 0
    });
    assert.equal(await readFile(path.join(cacheDir, 'nao-remover.txt'), 'utf8'), 'preservado');
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('clear bloqueia enquanto operação de transcode está protegida e funciona depois', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-cache-busy-'));
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });

  try {
    await writeFile(path.join(cacheDir, CACHE_A), Buffer.alloc(25));
    const maintenance = new TranscodeCacheMaintenance({
      cacheDir,
      limitBytes: 512,
      runtime: () => ({ active: 0, pending: 0 })
    });

    const operation = maintenance.withTranscode(async () => {
      entered();
      await releasePromise;
    });
    await enteredPromise;

    await assert.rejects(
      maintenance.clear(),
      (error: unknown) => (
        error instanceof TranscodeCacheBusyError
        && error.statusCode === 409
        && error.cache.active === 1
      )
    );

    release();
    await operation;
    const cleared = await maintenance.clear();
    assert.equal(cleared.freedBytes, 25);
    assert.equal(cleared.cache.bytes, 0);
  } finally {
    release?.();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('não acumula waiters de transcode enquanto manutenção está ativa', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-cache-backpressure-'));
  try {
    await writeFile(path.join(cacheDir, CACHE_A), Buffer.alloc(25));
    const maintenance = new TranscodeCacheMaintenance({
      cacheDir,
      limitBytes: 512,
      retryAfterSeconds: 6,
      runtime: () => ({ active: 0, pending: 0 })
    });

    const clearing = maintenance.clear();
    await assert.rejects(
      maintenance.withTranscode(async () => undefined),
      (error: unknown) => error instanceof HeavyWorkQueueSaturatedError
        && error.queueName === 'transcode-maintenance'
        && error.retryAfterSeconds === 6
    );
    await assert.rejects(
      maintenance.clear(),
      HeavyWorkQueueSaturatedError
    );
    await clearing;
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('diretório de cache apontado por symlink é rejeitado sem remover o alvo', async t => {
  if (process.platform === 'win32') {
    t.skip('Symlink de diretório exige permissões específicas no Windows.');
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-cache-symlink-'));
  const target = path.join(root, 'target');
  const cacheDir = path.join(root, 'cache');
  try {
    await mkdir(target);
    await writeFile(path.join(target, CACHE_A), Buffer.alloc(17));
    await symlink(target, cacheDir, 'dir');

    const maintenance = new TranscodeCacheMaintenance({
      cacheDir,
      limitBytes: 512,
      runtime: () => ({ active: 0, pending: 0 })
    });

    await assert.rejects(
      maintenance.clear(),
      (error: unknown) => error instanceof UnsafeTranscodeCacheDirectoryError
    );
    assert.equal((await readFile(path.join(target, CACHE_A))).byteLength, 17);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});