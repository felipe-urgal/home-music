import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  HeavyWorkQueueAbortedError,
  HeavyWorkQueueSaturatedError,
  withHeavyWorkRequestContext
} from './heavy-work-queue.js';
import { LongJobObservability } from './long-job-observability.js';
import {
  DEFAULT_TRANSCODE_CACHE_MEGABYTES,
  parseTranscodeCacheMegabytes,
  parseTranscodeQuality,
  seekableInputFd,
  TranscodeManager,
  transcodeCacheKey,
  type TranscodeRunner
} from './transcoding.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(next => { resolve = next; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error('Condição de teste não foi atingida.');
}

test('parseTranscodeQuality aceita somente perfis conhecidos', () => {
  assert.equal(parseTranscodeQuality(undefined), 'balanced');
  assert.equal(parseTranscodeQuality(''), 'balanced');
  assert.equal(parseTranscodeQuality('economy'), 'economy');
  assert.equal(parseTranscodeQuality('balanced'), 'balanced');
  assert.equal(parseTranscodeQuality('high'), 'high');
  assert.equal(parseTranscodeQuality('ultra'), null);
});

test('parseTranscodeCacheMegabytes aplica padrão e limites seguros', () => {
  assert.equal(parseTranscodeCacheMegabytes(undefined), DEFAULT_TRANSCODE_CACHE_MEGABYTES);
  assert.equal(parseTranscodeCacheMegabytes('512'), 512);
  assert.throws(() => parseTranscodeCacheMegabytes('63'));
  assert.throws(() => parseTranscodeCacheMegabytes('8193'));
  assert.throws(() => parseTranscodeCacheMegabytes('128.5'));
});

test('transcodeCacheKey muda com fonte e perfil', () => {
  const base = { trackId: 'track-a', sourceSize: 1234, sourceMtimeMs: 5678, quality: 'balanced' as const };
  const key = transcodeCacheKey(base);
  assert.equal(key.length, 64);
  assert.equal(transcodeCacheKey(base), key);
  assert.notEqual(transcodeCacheKey({ ...base, sourceSize: 1235 }), key);
  assert.notEqual(transcodeCacheKey({ ...base, sourceMtimeMs: 5679 }), key);
  assert.notEqual(transcodeCacheKey({ ...base, quality: 'economy' }), key);
  assert.notEqual(transcodeCacheKey({ ...base, normalizationGainDb: -7.5 }), key);
  assert.equal(transcodeCacheKey({ ...base, normalizationGainDb: -7.5 }), transcodeCacheKey({ ...base, normalizationGainDb: -7.5 }));
});

test('seekableInputFd só aceita descritor válido', () => {
  assert.equal(seekableInputFd({ fd: 17 }), 17);
  assert.equal(seekableInputFd({ fd: 0 }), 0);
  assert.equal(seekableInputFd({ fd: -1 }), null);
  assert.equal(seekableInputFd({ fd: null }), null);
  assert.equal(seekableInputFd({}), null);
});

test('TranscodeManager deduplica trabalho concorrente e reutiliza cache', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-transcode-'));
  let runs = 0;
  let inputs = 0;
  const runner: TranscodeRunner = async ({ outputPath, bitrate, normalizationGainDb, input }) => {
    runs += 1;
    assert.equal(bitrate, '160k');
    assert.equal(normalizationGainDb, -7.5);
    assert.equal(seekableInputFd(input), 17);
    await new Promise(resolve => setTimeout(resolve, 20));
    await writeFile(outputPath, Buffer.alloc(40, 1));
  };
  const manager = new TranscodeManager({
    cacheDir,
    command: 'ffmpeg-test',
    maxCacheBytes: 1_000,
    runner
  });
  const source = {
    trackId: 'track-a',
    sourceSize: 100,
    sourceMtimeMs: 200,
    quality: 'balanced' as const,
    normalizationGainDb: -7.5,
    createInput: () => {
      inputs += 1;
      return Object.assign(Readable.from(Buffer.from('source')), { fd: 17 });
    }
  };

  try {
    const [first, second] = await Promise.all([manager.prepare(source), manager.prepare(source)]);
    assert.equal(runs, 1);
    assert.equal(inputs, 1);
    assert.equal(first.path, second.path);
    assert.equal(first.size, 40);
    assert.equal(second.size, 40);
    assert.equal([first.cacheHit, second.cacheHit].filter(Boolean).length, 1);

    const third = await manager.prepare(source);
    assert.equal(third.cacheHit, true);
    assert.equal(runs, 1);
    assert.equal(inputs, 1);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('TranscodeManager mantém job deduplicado quando apenas um consumidor aborta', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-transcode-abort-dedupe-'));
  const started = deferred();
  const release = deferred();
  let runs = 0;
  let runnerSignal: AbortSignal | undefined;
  const runner: TranscodeRunner = async ({ outputPath, signal }) => {
    runs += 1;
    runnerSignal = signal;
    started.resolve();
    await release.promise;
    if (signal?.aborted) throw new Error('Job compartilhado foi abortado indevidamente.');
    await writeFile(outputPath, Buffer.alloc(40, 4));
  };
  const manager = new TranscodeManager({
    cacheDir,
    command: 'ffmpeg-test',
    maxCacheBytes: 1_000,
    runner
  });
  const source = {
    trackId: 'track-shared',
    sourceSize: 100,
    sourceMtimeMs: 200,
    quality: 'balanced' as const,
    createInput: () => Object.assign(Readable.from(Buffer.from('source')), { fd: 29 })
  };
  const firstController = new AbortController();
  const secondController = new AbortController();

  try {
    const first = withHeavyWorkRequestContext(
      { ownerId: 'user-a', signal: firstController.signal },
      () => manager.prepare(source)
    );
    await started.promise;
    const second = withHeavyWorkRequestContext(
      { ownerId: 'user-b', signal: secondController.signal },
      () => manager.prepare(source)
    );
    await new Promise(resolve => setTimeout(resolve, 5));

    firstController.abort();
    await assert.rejects(first, HeavyWorkQueueAbortedError);
    assert.equal(runnerSignal?.aborted, false);

    release.resolve();
    const prepared = await second;
    assert.equal(prepared.cacheHit, true);
    assert.equal(runs, 1);
    assert.equal(runnerSignal?.aborted, false);
  } finally {
    release.resolve();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('TranscodeManager rejeita burst além do backlog sem criar input', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-transcode-backpressure-'));
  const release = deferred();
  let runs = 0;
  const inputs = new Map<string, number>();
  const runner: TranscodeRunner = async ({ outputPath }) => {
    runs += 1;
    if (runs === 1) await release.promise;
    await writeFile(outputPath, Buffer.alloc(40, 5));
  };
  const manager = new TranscodeManager({
    cacheDir,
    command: 'ffmpeg-test',
    maxCacheBytes: 10_000,
    maxConcurrent: 1,
    maxPending: 1,
    maxPendingPerOwner: 1,
    retryAfterSeconds: 4,
    runner
  });
  const source = (trackId: string) => ({
    trackId,
    sourceSize: 100,
    sourceMtimeMs: 200,
    quality: 'balanced' as const,
    createInput: () => {
      inputs.set(trackId, (inputs.get(trackId) ?? 0) + 1);
      return Object.assign(Readable.from(Buffer.from('source')), { fd: 31 });
    }
  });

  try {
    const first = withHeavyWorkRequestContext({ ownerId: 'user-a' }, () => manager.prepare(source('a')));
    await waitFor(() => manager.queueRuntime.active === 1);
    const queued = withHeavyWorkRequestContext({ ownerId: 'user-b' }, () => manager.prepare(source('b')));
    await waitFor(() => manager.queueRuntime.pending === 1);

    await assert.rejects(
      withHeavyWorkRequestContext({ ownerId: 'user-c' }, () => manager.prepare(source('c'))),
      (error: unknown) => error instanceof HeavyWorkQueueSaturatedError
        && error.retryAfterSeconds === 4
    );
    assert.equal(inputs.get('c') ?? 0, 0);
    assert.equal(manager.queueRuntime.rejected, 1);

    release.resolve();
    await Promise.all([first, queued]);
    assert.equal(runs, 2);
  } finally {
    release.resolve();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('TranscodeManager observa somente a geração real e não cache hits', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-transcode-observe-'));
  const logs: Array<Record<string, unknown>> = [];
  const observability = new LongJobObservability({
    info(bindings) { logs.push(bindings as Record<string, unknown>); },
    warn(bindings) { logs.push(bindings as Record<string, unknown>); }
  }, { createId: () => 'transcode-job-1' });
  const runner: TranscodeRunner = async ({ outputPath }) => {
    await writeFile(outputPath, Buffer.alloc(40, 3));
  };
  const manager = new TranscodeManager({
    cacheDir,
    command: 'ffmpeg-test',
    maxCacheBytes: 1_000,
    runner,
    observability
  });
  const source = {
    trackId: 'track-observed',
    sourceSize: 100,
    sourceMtimeMs: 200,
    quality: 'balanced' as const,
    createInput: () => Object.assign(Readable.from(Buffer.from('source')), { fd: 23 })
  };

  try {
    const first = await manager.prepare(source);
    const second = await manager.prepare(source);

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.deepEqual(logs.map(item => item.event), ['long_job.started', 'long_job.completed']);
    assert.equal(logs[0].jobType, 'transcode');
    assert.equal(logs[0].jobId, 'transcode-transcode-job-1');
    assert.equal(logs[0].resourceId, 'track-observed');
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('TranscodeManager limita o cache removendo o item menos recente', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-transcode-limit-'));
  const runner: TranscodeRunner = async ({ outputPath }) => {
    await writeFile(outputPath, Buffer.alloc(40, 2));
  };
  const manager = new TranscodeManager({
    cacheDir,
    command: 'ffmpeg-test',
    maxCacheBytes: 60,
    runner
  });

  const source = (trackId: string) => ({
    trackId,
    sourceSize: 100,
    sourceMtimeMs: 200,
    quality: 'economy' as const,
    createInput: () => Object.assign(Readable.from(Buffer.from('source')), { fd: 19 })
  });

  try {
    const first = await manager.prepare(source('track-a'));
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = await manager.prepare(source('track-b'));
    const cachedFiles = (await readdir(cacheDir)).filter(name => name.endsWith('.m4a'));

    assert.equal(cachedFiles.length, 1);
    assert.ok(cachedFiles.includes(path.basename(second.path)));
    assert.ok(!cachedFiles.includes(path.basename(first.path)));
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});