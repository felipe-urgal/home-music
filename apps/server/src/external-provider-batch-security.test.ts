import assert from 'node:assert/strict';
import test from 'node:test';
import { ExternalProviderBatchManager, type ExternalProviderBatchInspector } from './external-provider-batch.js';
import { ImportJobQueue } from './import-job-queue.js';

async function waitForCompleted(manager: ExternalProviderBatchManager, batchId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const batch = manager.get(batchId);
    if (batch.status === 'completed') return batch;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('Lote não terminou no tempo esperado.');
}

test('erro interno inesperado não é exposto no payload público do lote', async () => {
  const inspector: ExternalProviderBatchInspector = {
    providerId: 'fake',
    inspect: async () => ({
      providerId: 'fake',
      label: 'Playlist',
      items: [{
        sourceId: 'video001',
        label: 'Faixa',
        durationSeconds: 120,
        request: { url: 'https://example.com/video001' },
        unavailableReason: null
      }]
    })
  };
  const manager = new ExternalProviderBatchManager({
    queue: new ImportJobQueue(),
    inspectors: [inspector],
    externalProviders: {
      listProviders: () => [{
        id: 'fake',
        label: 'Fake',
        capabilities: { audio: true, metadata: true, thumbnail: false, playlists: true },
        configured: true
      }],
      start: async () => {
        throw new Error('/srv/home-music/private/file?token=segredo');
      },
      cancel: async () => { throw new Error('não deveria cancelar'); },
      getPrepared: () => null
    },
    automaticFlow: {
      startWhenReady: async jobId => ({ jobId, reason: 'destination_review' }),
      disable: () => undefined
    },
    safeDestination: {
      promote: async () => { throw new Error('não deveria promover'); }
    },
    maxItems: 5,
    maxBytes: 10_000,
    maxDurationSeconds: 1_000,
    createId: () => 'batch-secure'
  });

  const preview = await manager.inspect('fake', { url: 'https://example.com/playlist' });
  assert.ok(preview);
  manager.start(preview.id, 'Importados');
  const done = await waitForCompleted(manager, preview.id);

  assert.equal(done.items[0].status, 'failed');
  assert.equal(done.items[0].error, 'Falha no item do lote.');
  assert.equal(JSON.stringify(done).includes('segredo'), false);
  assert.equal(JSON.stringify(done).includes('/srv/home-music/private'), false);
});
