import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  ImportUrlError,
  ImportUrlManager,
  isUnsafeImportAddress,
  parseImportUrlMaxMegabytes,
  parseImportUrlMaxRedirects,
  parseImportUrlTimeoutSeconds
} from './import-url.js';

type FakeResponseOptions = {
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: Uint8Array[];
};

function fakeResponse(options: FakeResponseOptions = {}) {
  const response = Readable.from(options.chunks ?? [Buffer.from('audio')]) as IncomingMessage;
  response.statusCode = options.statusCode ?? 200;
  response.headers = options.headers ?? {
    'content-type': 'audio/mpeg',
    'content-length': '5'
  };
  return response;
}

function fakeRequestFor(response: IncomingMessage) {
  return {
    destroy(error?: Error) {
      response.destroy(error);
      return this;
    }
  } as unknown as ReturnType<typeof http.request>;
}

async function waitForStatus(queue: ImportJobQueue, id: string, expected: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = queue.get(id);
    if (job?.status === expected) return job;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`Job ${id} não chegou ao estado ${expected}. Estado atual: ${queue.get(id)?.status}`);
}

async function fixture(options: Partial<ConstructorParameters<typeof ImportUrlManager>[0]> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-import-url-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = options.queue ?? new ImportJobQueue();
  const staging = options.staging ?? new ImportStagingManager({ stagingRoot, musicDir });
  const manager = new ImportUrlManager({
    queue,
    staging,
    maxBytes: 64,
    timeoutMs: 1000,
    maxRedirects: 2,
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    requestUrl: async () => {
      const response = fakeResponse();
      return { response, request: fakeRequestFor(response) };
    },
    validateAudio: async () => undefined,
    ...options
  });
  return { root, musicDir, stagingRoot, queue, staging, manager };
}

test('classifica endereços locais, privados, metadata e documentação como inseguros', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '198.18.0.1',
    '203.0.113.10',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1'
  ]) {
    assert.equal(isUnsafeImportAddress(address), true, address);
  }

  assert.equal(isUnsafeImportAddress('8.8.8.8'), false);
  assert.equal(isUnsafeImportAddress('2606:4700:4700::1111'), false);
});

test('valida configuração de tamanho, timeout e redirects', () => {
  assert.equal(parseImportUrlMaxMegabytes(undefined), 512);
  assert.equal(parseImportUrlTimeoutSeconds(undefined), 120);
  assert.equal(parseImportUrlMaxRedirects(undefined), 3);
  assert.throws(() => parseImportUrlMaxMegabytes('0'), /entre 1 e 8192/);
  assert.throws(() => parseImportUrlTimeoutSeconds('2'), /entre 5 e 900/);
  assert.throws(() => parseImportUrlMaxRedirects('11'), /entre 0 e 10/);
});

test('recusa protocolo, credenciais, portas alternativas e host local antes de criar job', async () => {
  const item = await fixture();
  try {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/audio.mp3',
      'https://user:secret@example.com/audio.mp3',
      'https://example.com:8443/audio.mp3',
      'http://localhost/audio.mp3',
      'http://service.internal/audio.mp3'
    ]) {
      await assert.rejects(() => item.manager.start(url), ImportUrlError, url);
    }
    assert.equal(item.queue.list().length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('falha quando DNS resolve para IP privado ou mistura IP público e privado', async () => {
  for (const addresses of [
    [{ address: '10.0.0.2', family: 4 as const }],
    [
      { address: '93.184.216.34', family: 4 as const },
      { address: '127.0.0.1', family: 4 as const }
    ]
  ]) {
    const item = await fixture({ resolveHost: async () => addresses });
    try {
      const { job } = await item.manager.start('https://example.com/audio.mp3');
      const failed = await waitForStatus(item.queue, job.id, 'failed');
      assert.match(failed.error ?? '', /rede não permitida/);
      assert.equal((await readdir(item.musicDir)).length, 0);
    } finally {
      await rm(item.root, { recursive: true, force: true });
    }
  }
});

test('revalida cada redirect e bloqueia salto para rede privada', async () => {
  const resolvedHosts: string[] = [];
  const item = await fixture({
    resolveHost: async hostname => {
      resolvedHosts.push(hostname);
      if (hostname === 'evil.example') return [{ address: '169.254.169.254', family: 4 }];
      return [{ address: '93.184.216.34', family: 4 }];
    },
    requestUrl: async url => {
      const response = url.hostname === 'example.com'
        ? fakeResponse({ statusCode: 302, headers: { location: 'http://evil.example/metadata' }, chunks: [] })
        : fakeResponse();
      return { response, request: fakeRequestFor(response) };
    }
  });

  try {
    const { job } = await item.manager.start('https://example.com/audio.mp3');
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.match(failed.error ?? '', /rede não permitida/);
    assert.deepEqual(resolvedHosts, ['example.com', 'evil.example']);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('grava somente no staging, inspeciona o arquivo e volta para pending', async () => {
  let inspectedSize = 0;
  const item = await fixture({
    validateAudio: async target => { inspectedSize = target.size; }
  });
  try {
    const { job } = await item.manager.start('https://example.com/library/faixa.mp3?token=segredo');
    assert.equal(job.status, 'processing');
    assert.equal(job.label.includes('token='), false);

    const pending = await waitForStatus(item.queue, job.id, 'pending');
    assert.equal(pending.source.type, 'url');
    assert.equal(inspectedSize, 5);
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 1);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('recusa Content-Type incompatível e limpa o staging', async () => {
  const item = await fixture({
    requestUrl: async () => {
      const response = fakeResponse({ headers: { 'content-type': 'text/html' } });
      return { response, request: fakeRequestFor(response) };
    }
  });
  try {
    const { job } = await item.manager.start('https://example.com/audio.mp3');
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.match(failed.error ?? '', /Content-Type/);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('aplica limite durante streaming mesmo sem Content-Length confiável', async () => {
  const item = await fixture({
    maxBytes: 4,
    requestUrl: async () => {
      const response = fakeResponse({
        headers: { 'content-type': 'audio/mpeg' },
        chunks: [Buffer.from('abc'), Buffer.from('def')]
      });
      return { response, request: fakeRequestFor(response) };
    }
  });
  try {
    const { job } = await item.manager.start('https://example.com/audio.mp3');
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.match(failed.error ?? '', /excede o limite/);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('propaga timeout acionável sem expor detalhes internos', async () => {
  const item = await fixture({
    requestUrl: async () => {
      throw new ImportUrlError('Tempo limite excedido ao baixar a URL.', 504);
    }
  });
  try {
    const { job } = await item.manager.start('https://example.com/audio.mp3');
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.equal(failed.error, 'Tempo limite excedido ao baixar a URL.');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('cancela download ativo, limpa staging e marca job como cancelled', async () => {
  const response = new PassThrough() as unknown as IncomingMessage;
  response.statusCode = 200;
  response.headers = { 'content-type': 'audio/mpeg' };
  const item = await fixture({
    requestUrl: async () => ({ response, request: fakeRequestFor(response) })
  });

  try {
    const { job } = await item.manager.start('https://example.com/audio.mp3');
    await new Promise(resolve => setImmediate(resolve));
    const cancelled = await item.manager.cancel(job.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    response.destroy();
    await rm(item.root, { recursive: true, force: true });
  }
});
