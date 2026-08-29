import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportMediaDecision, ImportMetadataPreview } from '@home-music/shared';
import { ImportAutomaticFlowManager } from './import-automatic-flow.js';
import type { ImportDuplicateCheck } from './import-duplicate-detection.js';
import { ImportJobQueue } from './import-job-queue.js';

const DECISION: ImportMediaDecision = {
  profile: 'original',
  action: 'preserve',
  reason: 'original-compatible',
  selectedAudioStream: 0,
  input: {
    container: 'webm', codec: 'opus', durationSeconds: 180,
    bitRate: 128_000, sampleRate: 48_000, channels: 2,
    audioStreams: 1, videoStreams: 0
  },
  output: { container: 'ogg', codec: 'opus', extension: '.opus', bitRate: 128_000 }
};

function preview(options: {
  title?: string | null;
  artist?: string | null;
  titleState?: ImportMetadataPreview['fieldStates']['title'];
  artistState?: ImportMetadataPreview['fieldStates']['artist'];
  providerTitle?: string | null;
  providerArtist?: string | null;
} = {}): ImportMetadataPreview {
  const title = options.title ?? null;
  const artist = options.artist ?? null;
  return {
    embedded: { title: null, artist: null, album: null, albumArtist: null },
    provider: {
      title: options.providerTitle ?? null,
      artist: options.providerArtist ?? null,
      album: null,
      albumArtist: null
    },
    overrides: { title: null, artist: null, album: null, albumArtist: null },
    effective: { title, artist, album: null, albumArtist: artist },
    fieldStates: {
      title: options.titleState ?? 'missing',
      artist: options.artistState ?? 'missing',
      album: 'missing',
      albumArtist: artist ? 'fallback' : 'missing'
    },
    durationSeconds: 180,
    cover: { available: false, contentType: null, sizeBytes: null },
    generatedAt: '2026-08-29T17:00:00.000Z'
  };
}

function duplicateCheck(disposition: ImportDuplicateCheck['disposition']): ImportDuplicateCheck {
  const confidence = disposition === 'blocked'
    ? 'exact'
    : disposition === 'review'
      ? 'probable'
      : disposition === 'notice'
        ? 'possible'
        : 'none';
  return {
    jobId: 'job',
    confidence,
    disposition,
    matches: [],
    hashCompared: true,
    checkedAt: '2026-08-29T17:00:00.000Z',
    reviewedAt: null
  };
}

function createFixture(options: {
  extractedPreview?: ImportMetadataPreview;
  check?: ImportDuplicateCheck;
  promoteAutomatically?: boolean;
} = {}) {
  const queue = new ImportJobQueue({ createId: () => 'job' });
  const job = queue.enqueue({ type: 'provider', provider: 'yt-dlp' }, 'yt-dlp');
  const calls: string[] = [];
  let currentCheck = options.check ?? duplicateCheck('clear');
  const extracted = options.extractedPreview ?? preview({
    titleState: 'suggested',
    artistState: 'suggested',
    providerTitle: 'Por Onde Andei',
    providerArtist: 'Nando Reis'
  });

  const mediaValidation = {
    validate: async (jobId: string) => {
      calls.push('validate');
      const updated = queue.setMediaDecision(jobId, DECISION)!;
      return { job: updated, validation: DECISION };
    }
  };
  const metadataPreview = {
    captureSource: async () => {
      calls.push('capture-metadata');
      return { embedded: { title: null, artist: null, album: null, albumArtist: null }, durationSeconds: null };
    },
    extract: async (jobId: string) => {
      calls.push('extract');
      const updated = queue.setMetadataPreview(jobId, extracted)!;
      return { job: updated, preview: extracted };
    },
    update: (jobId: string, rawPatch: unknown) => {
      calls.push('accept-suggestions');
      const patch = rawPatch as Record<string, string>;
      const before = queue.get(jobId)!.metadataPreview!;
      const next: ImportMetadataPreview = {
        ...before,
        overrides: {
          ...before.overrides,
          title: patch.title ?? before.overrides.title,
          artist: patch.artist ?? before.overrides.artist,
          album: patch.album ?? before.overrides.album
        },
        effective: {
          ...before.effective,
          title: patch.title ?? before.effective.title,
          artist: patch.artist ?? before.effective.artist,
          album: patch.album ?? before.effective.album,
          albumArtist: patch.artist ?? before.effective.albumArtist
        },
        fieldStates: {
          ...before.fieldStates,
          title: patch.title ? 'edited' : before.fieldStates.title,
          artist: patch.artist ? 'edited' : before.fieldStates.artist,
          album: patch.album ? 'edited' : before.fieldStates.album,
          albumArtist: patch.artist ? 'fallback' : before.fieldStates.albumArtist
        }
      };
      const updated = queue.setMetadataPreview(jobId, next)!;
      return { job: updated, preview: next };
    }
  };
  const duplicateDetection = {
    captureSource: async () => {
      calls.push('capture-fingerprint');
      return null;
    },
    forgetCheck: () => {
      calls.push('forget-duplicates');
      return true;
    },
    get: () => null,
    detect: async (jobId: string) => {
      calls.push('detect-duplicates');
      currentCheck = { ...currentCheck, jobId };
      return currentCheck;
    },
    isReady: () => currentCheck.disposition !== 'blocked'
      && (currentCheck.disposition !== 'review' || Boolean(currentCheck.reviewedAt))
  };
  const safeDestination = {
    promote: async (jobId: string) => {
      calls.push('promote');
      queue.transition(jobId, 'processing');
      const completed = queue.transition(jobId, 'completed')!;
      return {
        job: completed,
        destination: {
          folderPath: 'Importados',
          fileName: 'Nando Reis - Por Onde Andei.opus',
          relativePath: 'Importados/Nando Reis - Por Onde Andei.opus',
          collisionIndex: 1
        }
      };
    }
  };

  const manager = new ImportAutomaticFlowManager({
    queue,
    mediaValidation,
    metadataPreview,
    duplicateDetection,
    safeDestination,
    promoteAutomatically: options.promoteAutomatically,
    waitTimeoutMs: 500,
    pollIntervalMs: 5
  });
  return { queue, job, calls, manager };
}

test('happy path prepara tudo e pausa para confirmação do destino final', async () => {
  const item = createFixture();
  const outcome = await item.manager.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'destination_review');
  assert.equal(item.queue.get(item.job.id)?.status, 'pending');
  assert.deepEqual(item.calls, [
    'capture-metadata',
    'capture-fingerprint',
    'forget-duplicates',
    'validate',
    'extract',
    'accept-suggestions',
    'forget-duplicates',
    'detect-duplicates'
  ]);
});

test('modo explícito ainda pode promover automaticamente', async () => {
  const item = createFixture({ promoteAutomatically: true });
  const outcome = await item.manager.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'completed');
  assert.equal(item.queue.get(item.job.id)?.status, 'completed');
  assert.equal(item.calls.at(-1), 'promote');
});

test('aguarda aquisição assíncrona antes de iniciar validação', async () => {
  const item = createFixture();
  item.queue.transition(item.job.id, 'processing');
  setTimeout(() => item.queue.transition(item.job.id, 'pending'), 20);
  const outcome = await item.manager.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'destination_review');
  assert.equal(item.calls[0], 'capture-metadata');
});

test('metadata sem artista confiável pausa para revisão e preserva o job pendente', async () => {
  const item = createFixture({
    extractedPreview: preview({
      titleState: 'suggested',
      artistState: 'missing',
      providerTitle: 'Vídeo sem artista confiável',
      providerArtist: null
    })
  });
  const outcome = await item.manager.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'metadata_review');
  assert.equal(item.queue.get(item.job.id)?.status, 'pending');
  assert.equal(item.calls.includes('detect-duplicates'), false);
  assert.equal(item.calls.includes('promote'), false);
});

test('duplicata provável pausa para revisão explícita', async () => {
  const item = createFixture({ check: duplicateCheck('review') });
  const outcome = await item.manager.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'duplicate_review');
  assert.equal(item.queue.get(item.job.id)?.status, 'pending');
  assert.equal(item.calls.includes('promote'), false);
});

test('duplicata exata bloqueia promoção automática', async () => {
  const item = createFixture({ check: duplicateCheck('blocked') });
  const outcome = await item.manager.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'duplicate_blocked');
  assert.equal(item.queue.get(item.job.id)?.status, 'pending');
  assert.equal(item.calls.includes('promote'), false);
});

test('falha técnica interrompe etapas seguintes sem forçar nova transição', async () => {
  const item = createFixture();
  const failing = new ImportAutomaticFlowManager({
    queue: item.queue,
    mediaValidation: {
      validate: async () => {
        item.queue.transition(item.job.id, 'processing');
        item.queue.transition(item.job.id, 'failed', 'Falha técnica simulada.');
        throw new Error('Falha técnica simulada.');
      }
    },
    metadataPreview: {
      captureSource: async () => ({ embedded: { title: null, artist: null, album: null, albumArtist: null }, durationSeconds: null }),
      extract: async () => { throw new Error('não deveria executar'); },
      update: () => { throw new Error('não deveria executar'); }
    },
    duplicateDetection: {
      captureSource: async () => null,
      forgetCheck: () => false,
      get: () => null,
      detect: async () => { throw new Error('não deveria executar'); },
      isReady: () => false
    },
    safeDestination: {
      promote: async () => { throw new Error('não deveria executar'); }
    }
  });

  const outcome = await failing.startWhenReady(item.job.id);
  assert.equal(outcome.reason, 'error');
  assert.equal(item.queue.get(item.job.id)?.status, 'failed');
});
