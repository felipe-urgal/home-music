import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  DEFAULT_TRANSCODE_CACHE_MEGABYTES,
  parseTranscodeCacheMegabytes,
  parseTranscodeQuality,
  seekableInputFd,
  TranscodeManager,
  transcodeCacheKey,
  type TranscodeRunner
} from './transcoding.js';

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
  const runner: TranscodeRunner = async ({ outputPath, bitrate, input }) => {
    runs += 1;
    assert.equal(bitrate, '160k');
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
