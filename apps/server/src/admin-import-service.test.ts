import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  AdminImportService,
  type AdminImportServiceOptions
} from './admin-import-service.js';

test('import service disables automatic flow when an automatic upload fails while receiving bytes', async () => {
  const automaticStarts: string[] = [];
  const automaticDisables: string[] = [];
  const receiveError = new Error('falha parcial de upload');

  const options = {
    queue: {
      list: () => []
    },
    uploads: {
      config: { maxBytes: 1024 },
      start: async () => ({ job: { id: 'job-1' } }),
      receive: async () => { throw receiveError; },
      cancel: async () => ({ id: 'job-1' })
    },
    urls: {
      config: { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1 },
      start: async () => ({ job: { id: 'url-1' } }),
      cancel: async () => ({ id: 'url-1' })
    },
    externalProviders: {
      listProviders: () => [],
      start: async () => ({ job: { id: 'provider-1' } }),
      cancel: async () => ({ id: 'provider-1' })
    },
    mediaValidation: {
      profiles: [],
      validate: async () => ({})
    },
    metadataPreview: {
      captureSource: async () => undefined,
      extract: async () => ({}),
      update: () => ({}),
      getCover: () => null,
      forget: () => undefined
    },
    duplicateDetection: {
      captureSource: async () => undefined,
      forgetCheck: () => undefined,
      forget: () => undefined,
      get: () => null,
      detect: async () => ({}),
      review: () => ({})
    },
    safeDestination: {
      plan: async () => ({}),
      promote: async () => ({})
    },
    automaticFlow: {
      startWhenReady: async (jobId: string) => { automaticStarts.push(jobId); },
      disable: (jobId: string) => { automaticDisables.push(jobId); },
      isEnabled: () => false,
      resume: async () => undefined
    },
    logger: {
      warn: () => undefined
    }
  } as unknown as AdminImportServiceOptions;

  const service = new AdminImportService(options);
  await service.startUpload('track.flac', 10, true);

  await assert.rejects(
    service.receiveUpload('job-1', Readable.from(['bytes']), 5),
    error => error === receiveError
  );

  assert.deepEqual(automaticStarts, []);
  assert.deepEqual(automaticDisables, ['job-1']);
});

test('import service forgets derived state only after cancellation succeeds', async () => {
  const events: string[] = [];
  let shouldFail = true;

  const options = {
    queue: { list: () => [] },
    uploads: {
      config: {},
      start: async () => ({ job: { id: 'upload-1' } }),
      receive: async () => ({}),
      cancel: async () => ({ id: 'upload-1' })
    },
    urls: {
      config: {},
      start: async () => ({ job: { id: 'url-1' } }),
      cancel: async () => {
        if (shouldFail) throw new Error('cancel failed');
        return { id: 'url-1' };
      }
    },
    externalProviders: {
      listProviders: () => [],
      start: async () => ({ job: { id: 'provider-1' } }),
      cancel: async () => ({ id: 'provider-1' })
    },
    mediaValidation: { profiles: [], validate: async () => ({}) },
    metadataPreview: {
      captureSource: async () => undefined,
      extract: async () => ({}),
      update: () => ({}),
      getCover: () => null,
      forget: (jobId: string) => { events.push(`metadata:${jobId}`); }
    },
    duplicateDetection: {
      captureSource: async () => undefined,
      forgetCheck: () => undefined,
      forget: (jobId: string) => { events.push(`duplicates:${jobId}`); },
      get: () => null,
      detect: async () => ({}),
      review: () => ({})
    },
    safeDestination: { plan: async () => ({}), promote: async () => ({}) },
    automaticFlow: {
      startWhenReady: async () => undefined,
      disable: (jobId: string) => { events.push(`automatic:${jobId}`); },
      isEnabled: () => false,
      resume: async () => undefined
    },
    logger: { warn: () => undefined }
  } as unknown as AdminImportServiceOptions;

  const service = new AdminImportService(options);

  await assert.rejects(service.cancelUrl('url-1'), /cancel failed/);
  assert.deepEqual(events, []);

  shouldFail = false;
  await service.cancelUrl('url-1');
  assert.deepEqual(events, ['automatic:url-1', 'metadata:url-1', 'duplicates:url-1']);
});
