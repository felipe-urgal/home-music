import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExternalProviderPreparedResult } from './external-provider.js';
import {
  ExternalProviderBatchManager,
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

test('falha de aquisição em uma música é isolada e o lote segue para a próxima', async () => {
  let childCounter = 0;
  const queue = new ImportJobQueue({ createId: () => `child-${++childCounter}` });
  const prepared = new Map<string, ExternalProviderPreparedResult>();
  const startedUrls: string[] = [];
  const promoted: string[] = [];

  const inspector: ExternalProviderBatchInspector = {
    providerId: 'fake',
    inspect: async () => ({
      providerId: 'fake',
      label: 'Playlist com falha parcial',
      items: [
        {
          sourceId: 'video001',
          label: 'Faixa com erro',
          durationSeconds: 120,
          request: { url: 'https://example.com/video001' },
          unavailableReason: null
        },
        {
          sourceId: 'video002',
          label: 'Faixa seguinte',
          durationSeconds: 180,
          request: { url: 'https://example.com/video002' },
          unavailableReason: null
        }
      ]
    })
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
      if (request.url.endsWith('/video001')) {
        throw new Error('Falha simulada ao baixar a primeira faixa.');
      }

      const job = queue.enqueue({ type: 'provider', provider: 'fake' }, 'Item do lote');
      queue.transition(job.id, 'processing');
      queue.transition(job.id, 'pending');
      prepared.set(job.id, {
        jobId: job.id,
        provider: 'fake',
        metadata: { sourceId: null, title: null, artist: null, album: null, thumbnailUrl: null },
        payload: { sizeBytes: 10, contentType: 'audio/mpeg' }
      });
      return { job: queue.get(job.id)! };
    },
    cancel: async (jobId: string) => queue.get(jobId)!,
    getPrepared: (jobId: string) => prepared.get(jobId) ?? null
  };

  const automaticFlow = {
    startWhenReady: async (jobId: string): Promise<ImportAutomaticFlowOutcome> => ({
      jobId,
      reason: 'destination_review'
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
    maxItems: 10,
    maxBytes: 1_000,
    maxDurationSeconds: 10_000,
    createId: () => 'batch-partial-failure'
  });

  const preview = await manager.inspect('fake', { url: 'https://example.com/playlist' });
  assert.ok(preview);
  manager.start(preview.id, 'Importados');
  await waitUntil(() => manager.get(preview.id).status === 'completed');

  const done = manager.get(preview.id);
  assert.deepEqual(startedUrls, [
    'https://example.com/video001',
    'https://example.com/video002'
  ]);
  assert.equal(done.status, 'completed');
  assert.equal(done.items[0].status, 'failed');
  assert.equal(done.items[1].status, 'completed');
  assert.equal(done.summary.failed, 1);
  assert.equal(done.summary.completed, 1);
  assert.equal(done.summary.processed, 2);
  assert.deepEqual(promoted, ['child-1']);
});
