import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ImportUploadError, ImportUploadManager } from './import-upload.js';

async function fixture(maxBytes = 1024) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-upload-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const uploads = new ImportUploadManager({ queue, staging, maxBytes });
  return { root, musicDir, stagingRoot, queue, staging, uploads };
}

test('upload grava somente no staging e mantém job pendente para o restante do pipeline', async () => {
  const item = await fixture();
  try {
    const started = await item.uploads.start('Minha Música.mp3', 6);
    const result = await item.uploads.receive(started.job.id, Readable.from([Buffer.from('abc'), Buffer.from('def')]), 6);

    assert.equal(result.receivedBytes, 6);
    assert.equal(result.job.status, 'pending');
    assert.equal(result.job.source.type, 'upload');
    assert.equal(result.job.label, 'Minha Música.mp3');
    assert.equal(item.staging.hasJob(started.job.id), true);
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 1);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('upload rejeita formato inválido e arquivo acima do limite antes de criar staging', async () => {
  const item = await fixture(10);
  try {
    await assert.rejects(
      () => item.uploads.start('arquivo.exe', 4),
      (error: unknown) => error instanceof ImportUploadError && error.statusCode === 400
    );
    await assert.rejects(
      () => item.uploads.start('grande.flac', 11),
      (error: unknown) => error instanceof ImportUploadError && error.statusCode === 413
    );
    assert.equal(item.queue.list().length, 0);
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.deepEqual(await readdir(item.root), ['music']);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('upload rejeita bytes além do tamanho declarado, falha o job e limpa staging', async () => {
  const item = await fixture(16);
  try {
    const started = await item.uploads.start('faixa.flac', 4);
    await assert.rejects(
      () => item.uploads.receive(started.job.id, Readable.from([Buffer.alloc(5)])),
      (error: unknown) => error instanceof ImportUploadError && error.statusCode === 413
    );

    assert.equal(item.queue.get(started.job.id)?.status, 'failed');
    assert.equal(item.staging.hasJob(started.job.id), false);
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('cancelamento durante o recebimento encerra job e remove staging', async () => {
  const item = await fixture(1024);
  try {
    const started = await item.uploads.start('cancelar.ogg', 8);
    let releaseSecondChunk!: () => void;
    const waitSecondChunk = new Promise<void>(resolve => { releaseSecondChunk = resolve; });
    let firstChunkRead!: () => void;
    const firstChunk = new Promise<void>(resolve => { firstChunkRead = resolve; });

    async function* chunks() {
      yield Buffer.from('1234');
      firstChunkRead();
      await waitSecondChunk;
      yield Buffer.from('5678');
    }

    const receiving = item.uploads.receive(started.job.id, Readable.from(chunks()));
    await firstChunk;
    const cancelling = item.uploads.cancel(started.job.id);
    releaseSecondChunk();
    const cancelled = await cancelling;
    await assert.rejects(receiving);

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(item.queue.get(started.job.id)?.status, 'cancelled');
    assert.equal(item.staging.hasJob(started.job.id), false);
    assert.equal((await readdir(item.musicDir)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
