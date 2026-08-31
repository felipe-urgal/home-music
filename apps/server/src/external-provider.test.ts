import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import {
  ExternalProviderError,
  ExternalProviderImportManager,
  type ExternalProvider,
  type ExternalProviderContext,
  type ExternalProviderPreparedMedia,
  type ExternalProviderRequest
} from './external-provider.js';

type FakeOptions = {
  id?: string;
  label?: string;
  requiredConfigKeys?: readonly string[];
  validate?: (request: ExternalProviderRequest) => Promise<void> | void;
  prepare?: (
    request: ExternalProviderRequest,
    context: ExternalProviderContext
  ) => Promise<ExternalProviderPreparedMedia>;
};

function fakeProvider(options: FakeOptions = {}): ExternalProvider {
  return {
    id: options.id ?? 'fake',
    label: options.label ?? 'Provider Fake',
    capabilities: {
      audio: true,
      metadata: true,
      thumbnail: true,
      playlists: false
    },
    requiredConfigKeys: options.requiredConfigKeys,
    validate: options.validate ?? (() => undefined),
    prepare: options.prepare ?? (async (_request, context) => {
      await writeFile(path.join(context.scratchDir, 'media.bin'), Buffer.from('audio'));
      return {
        relativePath: 'media.bin',
        contentType: 'audio/mpeg',
        metadata: {
          sourceId: 'source-1',
          title: 'Faixa externa',
          artist: 'Artista externo',
          album: 'Album externo',
          thumbnailUrl: 'https://cdn.example/capa.jpg?signature=transient'
        }
      };
    })
  };
}

async function fixture(options: {
  providers?: readonly ExternalProvider[];
  providerConfigs?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  scratchInsideMusic?: boolean;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-provider-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  const scratchRoot = options.scratchInsideMusic
    ? path.join(musicDir, 'provider-scratch')
    : path.join(root, 'provider-scratch');
  await mkdir(musicDir);

  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const scratch = new ExternalProviderScratchManager({ scratchRoot, musicDir });
  const manager = new ExternalProviderImportManager({
    queue,
    staging,
    scratch,
    providers: options.providers ?? [fakeProvider()],
    providerConfigs: options.providerConfigs,
    timeoutMs: options.timeoutMs ?? 1000,
    maxOutputBytes: options.maxOutputBytes ?? 64
  });

  return { root, musicDir, stagingRoot, scratchRoot, queue, staging, scratch, manager };
}

async function waitForStatus(queue: ImportJobQueue, id: string, expected: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = queue.get(id);
    if (job?.status === expected) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Job ${id} não chegou ao estado ${expected}. Atual: ${queue.get(id)?.status}`);
}

test('lista capabilities sem expor configuração e devolve snapshots defensivos', async () => {
  const item = await fixture({
    providers: [fakeProvider({ requiredConfigKeys: ['token'] })],
    providerConfigs: { fake: { token: 'segredo' } }
  });
  try {
    const providers = item.manager.listProviders();
    assert.deepEqual(providers, [{
      id: 'fake',
      label: 'Provider Fake',
      capabilities: { audio: true, metadata: true, thumbnail: true, playlists: false },
      configured: true
    }]);
    assert.equal(JSON.stringify(providers).includes('segredo'), false);

    (providers[0].capabilities as { audio: boolean }).audio = false;
    assert.equal(item.manager.listProviders()[0].capabilities.audio, true);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('recusa provider duplicado na composição da aplicação', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-provider-duplicate-'));
  const musicDir = path.join(root, 'music');
  await mkdir(musicDir);
  try {
    assert.throws(() => new ExternalProviderImportManager({
      queue: new ImportJobQueue(),
      staging: new ImportStagingManager({ stagingRoot: path.join(root, 'staging'), musicDir }),
      scratch: new ExternalProviderScratchManager({ scratchRoot: path.join(root, 'scratch'), musicDir }),
      providers: [fakeProvider(), fakeProvider()]
    }), /Provider duplicado/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('valida entrada antes de criar job e não persiste URL original na fila', async () => {
  const seen: string[] = [];
  const item = await fixture({
    providers: [fakeProvider({
      validate: request => {
        seen.push(request.url);
        if (!request.url.startsWith('https://allowed.example/')) throw new Error('não suportada');
      }
    })]
  });
  try {
    await assert.rejects(
      () => item.manager.start('fake', { url: 'https://denied.example/faixa' }),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input'
    );
    assert.equal(item.queue.list().length, 0);

    const { job } = await item.manager.start('fake', {
      url: 'https://allowed.example/faixa?token=segredo#fragmento'
    });
    assert.equal(job.status, 'processing');
    assert.equal(job.label.includes('token='), false);
    assert.equal(job.label.includes('allowed.example'), false);
    assert.equal(seen.at(-1), 'https://allowed.example/faixa?token=segredo');
    await waitForStatus(item.queue, job.id, 'pending');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('exige configuração declarada pelo provider sem expor segredo', async () => {
  const provider = fakeProvider({ requiredConfigKeys: ['apiToken'] });
  const missing = await fixture({ providers: [provider] });
  try {
    assert.equal(missing.manager.listProviders()[0].configured, false);
    await assert.rejects(
      () => missing.manager.start('fake', { url: 'https://example.com/faixa' }),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'provider_not_configured'
    );
    assert.equal(missing.queue.list().length, 0);
  } finally {
    await rm(missing.root, { recursive: true, force: true });
  }

  let receivedConfig = '';
  const configuredItem = await fixture({
    providers: [fakeProvider({
      requiredConfigKeys: ['apiToken'],
      prepare: async (_request, context) => {
        receivedConfig = context.config.apiToken;
        await writeFile(path.join(context.scratchDir, 'media.bin'), 'audio');
        return { relativePath: 'media.bin' };
      }
    })],
    providerConfigs: { fake: { apiToken: 'token-secreto' } }
  });
  try {
    const { job } = await configuredItem.manager.start('fake', { url: 'https://example.com/faixa' });
    await waitForStatus(configuredItem.queue, job.id, 'pending');
    assert.equal(receivedConfig, 'token-secreto');
    assert.equal(JSON.stringify(configuredItem.manager.listProviders()).includes('token-secreto'), false);
  } finally {
    await rm(configuredItem.root, { recursive: true, force: true });
  }
});

test('provider prepara em scratch e core transfere para staging sem tocar MUSIC_DIR', async () => {
  const item = await fixture();
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const pending = await waitForStatus(item.queue, job.id, 'pending');
    assert.equal(pending.source.type, 'provider');
    assert.equal(pending.source.provider, 'fake');
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 1);
    assert.equal((await readdir(item.scratchRoot)).length, 0);

    const prepared = item.manager.getPrepared(job.id);
    assert.deepEqual(prepared, {
      jobId: job.id,
      provider: 'fake',
      metadata: {
        sourceId: 'source-1',
        title: 'Faixa externa',
        artist: 'Artista externo',
        album: 'Album externo',
        thumbnailUrl: 'https://cdn.example/capa.jpg?signature=transient'
      },
      payload: {
        sizeBytes: 5,
        contentType: 'audio/mpeg'
      }
    });

    assert.ok(prepared);
    (prepared.metadata as { title: string | null }).title = 'mutação externa';
    assert.equal(item.manager.getPrepared(job.id)?.metadata.title, 'Faixa externa');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('scratch dentro de MUSIC_DIR é recusado antes de criar diretório', async () => {
  const item = await fixture({ scratchInsideMusic: true });
  try {
    await assert.rejects(
      () => item.manager.start('fake', { url: 'https://example.com/faixa' }),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'setup_failed'
    );
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal(item.queue.list()[0]?.status, 'failed');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('recusa path traversal e limpa scratch/staging', async () => {
  const item = await fixture({
    providers: [fakeProvider({
      prepare: async () => ({ relativePath: '../fora.mp3' })
    })]
  });
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.match(failed.error ?? '', /saída inválida/);
    assert.equal((await readdir(item.musicDir)).length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
    assert.equal((await readdir(item.scratchRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('recusa symlink retornado pelo provider', async () => {
  const item = await fixture({
    providers: [fakeProvider({
      prepare: async (_request, context) => {
        const outside = path.join(itemRootFromScratch(context.scratchDir), 'outside.bin');
        await writeFile(outside, 'audio');
        await symlink(outside, path.join(context.scratchDir, 'media.bin'));
        return { relativePath: 'media.bin' };
      }
    })]
  });
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.match(failed.error ?? '', /saída inválida/);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

function itemRootFromScratch(scratchDir: string) {
  return path.dirname(path.dirname(scratchDir));
}

test('aplica limite de bytes no resultado antes de manter staging pendente', async () => {
  const item = await fixture({
    maxOutputBytes: 4,
    providers: [fakeProvider({
      prepare: async (_request, context) => {
        await writeFile(path.join(context.scratchDir, 'media.bin'), '12345');
        return { relativePath: 'media.bin' };
      }
    })]
  });
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.match(failed.error ?? '', /excede o limite/);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
    assert.equal((await readdir(item.scratchRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('timeout aborta o contexto, normaliza erro e limpa recursos', async () => {
  let aborted = false;
  const item = await fixture({
    timeoutMs: 10,
    providers: [fakeProvider({
      prepare: async (_request, context) => new Promise<ExternalProviderPreparedMedia>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          aborted = true;
          reject(context.signal.reason);
        }, { once: true });
      })
    })]
  });
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.equal(aborted, true);
    assert.equal(failed.error, 'O provider externo excedeu o tempo limite.');
    assert.equal((await readdir(item.stagingRoot)).length, 0);
    assert.equal((await readdir(item.scratchRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('cancelamento aborta provider ativo e marca job como cancelled', async () => {
  let aborted = false;
  const item = await fixture({
    providers: [fakeProvider({
      prepare: async (_request, context) => new Promise<ExternalProviderPreparedMedia>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          aborted = true;
          reject(context.signal.reason);
        }, { once: true });
      })
    })]
  });
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const cancelled = await item.manager.cancel(job.id);
    assert.equal(aborted, true);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await readdir(item.stagingRoot)).length, 0);
    assert.equal((await readdir(item.scratchRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('cancelamento de job pending remove payload preparado', async () => {
  const item = await fixture();
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    await waitForStatus(item.queue, job.id, 'pending');
    assert.ok(item.manager.getPrepared(job.id));

    const cancelled = await item.manager.cancel(job.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(item.manager.getPrepared(job.id), null);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('erros do adapter são canonicalizados e não vazam detalhes para a fila', async () => {
  const item = await fixture({
    providers: [fakeProvider({
      prepare: async () => {
        throw new ExternalProviderError(
          'provider_failed',
          'token-secreto stack interno /etc/passwd',
          502
        );
      }
    })]
  });
  try {
    const { job } = await item.manager.start('fake', { url: 'https://example.com/faixa' });
    const failed = await waitForStatus(item.queue, job.id, 'failed');
    assert.equal(failed.error, 'Falha ao executar o provider externo.');
    assert.equal(failed.error?.includes('token-secreto'), false);
    assert.equal(failed.error?.includes('/etc/passwd'), false);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
