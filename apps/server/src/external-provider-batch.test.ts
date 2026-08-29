import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportJob } from '@home-music/shared';
import type { ExternalProviderPreparedResult } from './external-provider.js';
import {
  ExternalProviderBatchError,
  ExternalProviderBatchManager,
  parseProviderBatchMaxDurationMinutes,
  parseProviderBatchMaxItems,
  parseProviderBatchMaxMegabytes,
  type ExternalProviderBatchInspection,
  type ExternalProviderBatchInspector
} from './external-provider-batch.js';
import type { ImportAutomaticFlowOutcome } from './import-automatic-flow.js';
import { ImportJobQueue } from './import-job-queue.js';

function waitUntil(predicate: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      if (predicate()) {
        resolve();
        return;
      }
      attempts += 1;
      if (attempts > 200) {
        reject(new Error('Condição do teste não foi atingida.'));
        return;
      }
      setTimeout(check, 2);
    };
    check();
  });
}

function inspection(items: Array<{
  id?: string | null;
  label?: string;
  duration?: number | null;
  unavailable?: boolean;
}> = [
  { id: 'video001', label: 'Faixa 1', duration: 120 },
  { id: 'video002', label: 'Faixa 2', duration: 180 }
]): ExternalProviderBatchInspection {
  return {
    providerId: 'fake',
    label: 'Minha playlist',
    items: items.map((item, index) => ({
      sourceId: item.id ?? null,
      label: item.label ?? `Faixa ${index + 1}`,
      durationSeconds: item.duration ?? null,
      request: item.unavailable ? null : { url: `https://example.com/${item.id ?? index}` },
      unavailableReason: item.unavailable ? 'Indisponível' : null
    }))
  };
}

type FixtureOptions = {
  inspected?: ExternalProviderBatchInspection;
  outcomes?: ImportAutomaticFlowOutcome['reason'][];
  sizes?: number[];
  maxItems?: number;
  maxBytes?: number;
  maxDurationSeconds?: number;
  blockFirstStart?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  let childCounter = 0;
  const queue = new ImportJobQueue({ createId: () => `child-${++childCounter}` });
  const prepared = new Map<string, ExternalProviderPreparedResult>();
  const startedUrls: string[] = [];
  const cancelled: string[] = [];
  const promoted: string[] = [];
  const discarded: string[] = [];
  let releaseFirstStart: (() => void) | null = null;
  const firstStartGate = options.blockFirstStart
    ? new Promise<void>(resolve => { releaseFirstStart = resolve; })
    : null;

  const inspector: ExternalProviderBatchInspector = {
    providerId: 'fake',
    inspect: async () => options.inspected ?? inspection()
  };

  const externalProviders = {
    listProviders: () => [{
      id: 'fake',
      label: 'Fake',
      capabilities: { audio: true, metadata: true, thumbnail: false, playlists: false },
      configured: true
    }],
    start: async (_providerId: string, request: { url: string }) => {
      startedUrls.push(request.url);
      const job = queue.enqueue({ type: 'provider', provider: 'fake' }, 'Item do lote');
      queue.transition(job.id, 'processing');
      if (firstStartGate && startedUrls.length === 1) await firstStartGate;
      queue.transition(job.id, 'pending');
      const index = startedUrls.length - 1;
      prepared.set(job.id, {
        jobId: job.id,
        provider: 'fake',
        metadata: { sourceId: null, title: null, artist: null, album: null, thumbnailUrl: null },
        payload: { sizeBytes: options.sizes?.[index] ?? 10, contentType: 'audio/mpeg' }
      });
      return { job: queue.get(job.id)! };
    },
    cancel: async (jobId: string) => {
      cancelled.push(jobId);
      prepared.delete(jobId);
      const job = queue.get(jobId);
      if (job?.status === 'processing' || job?.status === 'pending') queue.transition(jobId, 'cancelled');
      return queue.get(jobId)!;
    },
    getPrepared: (jobId: string) => prepared.get(jobId) ?? null
  };

  let outcomeIndex = 0;
  const automaticFlow = {
    startWhenReady: async (jobId: string): Promise<ImportAutomaticFlowOutcome> => ({
      jobId,
      reason: options.outcomes?.[outcomeIndex++] ?? 'destination_review'
    }),
    disable: () => undefined
  };

  const safeDestination = {
    promote: async (jobId: string, folderPath?: unknown) => {
      promoted.push(jobId);
      queue.transition(jobId, 'processing');
      const job = queue.transition(jobId, 'completed')!;
      const folder = typeof folderPath === 'string' && folderPath ? folderPath : 'Importados';
      return {
        job,
        destination: {
          folderPath: folder,
          fileName: `${jobId}.mp3`,
          relativePath: `${folder}/${jobId}.mp3`,
          collisionIndex: 1
        }
      };
    }
  };

  const manager = new ExternalProviderBatchManager({
    queue,
    externalProviders,
    automaticFlow,
    safeDestination,
    inspectors: [inspector],
    maxItems: options.maxItems ?? 10,
    maxBytes: options.maxBytes ?? 1_000,
    maxDurationSeconds: options.maxDurationSeconds ?? 10_000,
    createId: () => 'batch-1',
    afterDiscard: jobId => { discarded.push(jobId); }
  });

  return {
    manager,
    queue,
    prepared,
    startedUrls,
    cancelled,
    promoted,
    discarded,
    releaseFirstStart: () => releaseFirstStart?.()
  };
}

test('parsers de limites aceitam valores positivos e recusam configuração inválida', () => {
  assert.equal(parseProviderBatchMaxItems('25'), 25);
  assert.equal(parseProviderBatchMaxMegabytes('512'), 512);
  assert.equal(parseProviderBatchMaxDurationMinutes('90'), 90);
  assert.throws(() => parseProviderBatchMaxItems('0'), /inválido/);
  assert.throws(() => parseProviderBatchMaxMegabytes('-1'), /inválido/);
  assert.throws(() => parseProviderBatchMaxDurationMinutes('abc'), /inválido/);
});

test('preview não expõe URLs internas dos itens e valida duração conhecida', async () => {
  const item = fixture();
  const batch = await item.manager.inspect('fake', { url: 'https://example.com/lista?token=segredo' });
  assert.ok(batch);
  assert.equal(batch.label, 'Minha playlist');
  assert.equal(batch.summary.total, 2);
  assert.equal(batch.summary.processed, 0);
  assert.equal(JSON.stringify(batch).includes('token=segredo'), false);
  assert.equal(JSON.stringify(batch).includes('https://example.com/video001'), false);

  const limited = fixture({ maxDurationSeconds: 100 });
  await assert.rejects(
    () => limited.manager.inspect('fake', { url: 'https://example.com/lista' }),
    (error: unknown) => error instanceof ExternalProviderBatchError && error.code === 'batch_limit_exceeded'
  );
});

test('importa itens sequencialmente para o mesmo destino seguro', async () => {
  const item = fixture();
  const preview = await item.manager.inspect('fake', { url: 'https://example.com/lista' });
  assert.ok(preview);
  const started = item.manager.start(preview.id, 'Rock/Anos 90');
  assert.equal(started.status, 'running');
  await waitUntil(() => item.manager.get(preview.id).status === 'completed');

  const done = item.manager.get(preview.id);
  assert.deepEqual(item.startedUrls, ['https://example.com/video001', 'https://example.com/video002']);
  assert.deepEqual(item.promoted, ['child-1', 'child-2']);
  assert.equal(done.summary.completed, 2);
  assert.equal(done.summary.failed, 0);
  assert.equal(done.summary.importedBytes, 20);
  assert.equal(done.summary.importedDurationSeconds, 300);
  assert.equal(done.items[0].destination, 'Rock/Anos 90/child-1.mp3');
});

test('não baixa sourceId repetido dentro do próprio lote', async () => {
  const item = fixture({
    inspected: inspection([
      { id: 'video001', label: 'Primeira' },
      { id: 'video001', label: 'Repetida' },
      { id: 'video002', label: 'Segunda' }
    ])
  });
  const preview = await item.manager.inspect('fake', { url: 'https://example.com/lista' });
  assert.ok(preview);
  item.manager.start(preview.id);
  await waitUntil(() => item.manager.get(preview.id).status === 'completed');
  const done = item.manager.get(preview.id);
  assert.equal(item.startedUrls.length, 2);
  assert.equal(done.summary.completed, 2);
  assert.equal(done.summary.duplicates, 1);
  assert.equal(done.items[1].status, 'duplicate');
});

test('falha ou revisão de um item não interrompe os demais e limpa staging do descartado', async () => {
  const item = fixture({ outcomes: ['metadata_review', 'destination_review'] });
  const preview = await item.manager.inspect('fake', { url: 'https://example.com/lista' });
  assert.ok(preview);
  item.manager.start(preview.id);
  await waitUntil(() => item.manager.get(preview.id).status === 'completed');
  const done = item.manager.get(preview.id);
  assert.equal(done.items[0].status, 'ignored');
  assert.equal(done.items[1].status, 'completed');
  assert.deepEqual(item.cancelled, ['child-1']);
  assert.deepEqual(item.discarded, ['child-1']);
  assert.deepEqual(item.promoted, ['child-2']);
});

test('limite real de bytes é aplicado antes da promoção e lote continua', async () => {
  const item = fixture({ sizes: [80, 30], maxBytes: 100 });
  const preview = await item.manager.inspect('fake', { url: 'https://example.com/lista' });
  assert.ok(preview);
  item.manager.start(preview.id);
  await waitUntil(() => item.manager.get(preview.id).status === 'completed');
  const done = item.manager.get(preview.id);
  assert.equal(done.items[0].status, 'completed');
  assert.equal(done.items[1].status, 'failed');
  assert.equal(done.summary.importedBytes, 80);
  assert.deepEqual(item.promoted, ['child-1']);
  assert.deepEqual(item.cancelled, ['child-2']);
});

test('item indisponível é ignorado sem criar job', async () => {
  const item = fixture({
    inspected: inspection([
      { id: null, label: 'Privado', unavailable: true },
      { id: 'video002', label: 'Disponível' }
    ])
  });
  const preview = await item.manager.inspect('fake', { url: 'https://example.com/lista' });
  assert.ok(preview);
  item.manager.start(preview.id);
  await waitUntil(() => item.manager.get(preview.id).status === 'completed');
  const done = item.manager.get(preview.id);
  assert.equal(done.items[0].status, 'ignored');
  assert.equal(done.summary.ignored, 1);
  assert.equal(item.startedUrls.length, 1);
});

test('cancelamento durante aquisição cancela filho atual e não inicia próximos itens', async () => {
  const item = fixture({ blockFirstStart: true });
  const preview = await item.manager.inspect('fake', { url: 'https://example.com/lista' });
  assert.ok(preview);
  item.manager.start(preview.id);
  await waitUntil(() => item.startedUrls.length === 1);
  const cancelling = await item.manager.cancel(preview.id);
  assert.equal(cancelling.status, 'cancelling');
  item.releaseFirstStart();
  await waitUntil(() => item.manager.get(preview.id).status === 'cancelled');
  const done = item.manager.get(preview.id);
  assert.equal(item.startedUrls.length, 1);
  assert.equal(done.summary.cancelled, 2);
});
