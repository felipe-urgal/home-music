import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  ImportMetadataPreviewError,
  ImportMetadataPreviewManager,
  type ImportMetadataReadResult
} from './import-metadata-preview.js';

async function fixture(options: {
  metadata?: Partial<ImportMetadataReadResult>;
  provider?: { title?: string | null; artist?: string | null; album?: string | null; albumArtist?: string | null } | null;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-metadata-preview-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const job = queue.enqueue({ type: 'upload', provider: null }, 'Faixa sem tag.flac');
  await staging.createJob(job.id);
  await staging.writePayload(job.id, [Buffer.from('audio')]);
  queue.setMediaDecision(job.id, {
    profile: 'original',
    action: 'preserve',
    reason: 'original-compatible',
    selectedAudioStream: 0,
    input: {
      container: 'flac',
      codec: 'flac',
      durationSeconds: 183.25,
      bitRate: 700_000,
      sampleRate: 48_000,
      channels: 2,
      audioStreams: 1,
      videoStreams: 0
    },
    output: { container: 'flac', codec: 'flac', extension: '.flac', bitRate: 700_000 }
  });

  const baseMetadata: ImportMetadataReadResult = {
    title: 'Título local',
    artist: 'Artista local',
    album: 'Álbum local',
    albumArtist: 'Artista local',
    durationSeconds: 183.2,
    cover: null
  };
  const manager = new ImportMetadataPreviewManager({
    queue,
    staging,
    validatedLookup: () => ({ token: 'validated' }),
    providerMetadata: () => options.provider ?? null,
    metadataReader: async () => ({ ...baseMetadata, ...options.metadata }),
    now: () => new Date('2026-08-29T12:00:00.000Z')
  });
  return { root, queue, staging, job, manager };
}

test('metadata embutida validada vence sugestão conflitante do provider', async () => {
  const item = await fixture({
    provider: {
      title: 'Título externo',
      artist: 'Artista local',
      album: 'Outro álbum'
    }
  });
  try {
    await item.manager.captureSource(item.job.id);
    const result = await item.manager.extract(item.job.id);
    assert.equal(result.preview.effective.title, 'Título local');
    assert.equal(result.preview.effective.artist, 'Artista local');
    assert.equal(result.preview.effective.album, 'Álbum local');
    assert.equal(result.preview.provider?.title, 'Título externo');
    assert.equal(result.preview.fieldStates.title, 'conflict');
    assert.equal(result.preview.fieldStates.artist, 'trusted');
    assert.equal(result.preview.fieldStates.album, 'conflict');
    assert.equal(result.preview.durationSeconds, 183.25);
    assert.equal(result.job.status, 'pending');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('metadata parcial usa provider somente como sugestão e fallback local de filename', async () => {
  const item = await fixture({
    metadata: { title: null, artist: null, album: null, albumArtist: null },
    provider: { artist: 'Artista sugerido', album: 'Álbum sugerido' }
  });
  try {
    await item.manager.captureSource(item.job.id);
    const result = await item.manager.extract(item.job.id);
    assert.equal(result.preview.effective.title, 'Faixa sem tag');
    assert.equal(result.preview.fieldStates.title, 'fallback');
    assert.equal(result.preview.effective.artist, 'Artista sugerido');
    assert.equal(result.preview.fieldStates.artist, 'suggested');
    assert.equal(result.preview.effective.album, 'Álbum sugerido');
    assert.equal(result.preview.fieldStates.album, 'suggested');
    assert.equal(result.preview.effective.albumArtist, 'Artista sugerido');
    assert.equal(result.preview.fieldStates.albumArtist, 'fallback');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('ajustes do preview são reversíveis e não alteram metadata embutida', async () => {
  const item = await fixture();
  try {
    await item.manager.captureSource(item.job.id);
    await item.manager.extract(item.job.id);
    const edited = item.manager.update(item.job.id, { title: '  Título revisado  ', album: 'Álbum revisado' });
    assert.equal(edited.preview.embedded.title, 'Título local');
    assert.equal(edited.preview.effective.title, 'Título revisado');
    assert.equal(edited.preview.overrides.title, 'Título revisado');
    assert.equal(edited.preview.fieldStates.title, 'edited');

    const restored = item.manager.update(item.job.id, { title: null });
    assert.equal(restored.preview.overrides.title, null);
    assert.equal(restored.preview.effective.title, 'Título local');
    assert.equal(restored.preview.fieldStates.title, 'trusted');

    assert.throws(
      () => item.manager.update(item.job.id, { artist: '   ' }),
      (error: unknown) => error instanceof ImportMetadataPreviewError && error.code === 'invalid_metadata'
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('capa embutida segura fica disponível somente pelo endpoint dedicado do manager', async () => {
  const coverBytes = Buffer.from('fake-png');
  const item = await fixture({
    metadata: { cover: { data: coverBytes, contentType: 'image/png' } }
  });
  try {
    await item.manager.captureSource(item.job.id);
    const result = await item.manager.extract(item.job.id);
    assert.equal(result.preview.cover.available, true);
    assert.equal(result.preview.cover.contentType, 'image/png');
    assert.equal(result.preview.cover.sizeBytes, coverBytes.byteLength);
    const cover = item.manager.getCover(item.job.id);
    assert.equal(cover?.contentType, 'image/png');
    assert.deepEqual(cover?.data, coverBytes);
    cover!.data[0] = 0;
    assert.deepEqual(item.manager.getCover(item.job.id)?.data, coverBytes);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('preview exige validação técnica concluída', async () => {
  const item = await fixture();
  try {
    const manager = new ImportMetadataPreviewManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => null,
      metadataReader: async () => ({
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        durationSeconds: null,
        cover: null
      })
    });
    await assert.rejects(
      () => manager.extract(item.job.id),
      (error: unknown) => error instanceof ImportMetadataPreviewError && error.code === 'media_not_validated'
    );
    assert.equal(item.queue.get(item.job.id)?.status, 'pending');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('snapshot e preview retornados pela fila são defensivos', async () => {
  const item = await fixture();
  try {
    await item.manager.captureSource(item.job.id);
    await item.manager.extract(item.job.id);
    const snapshot = item.queue.get(item.job.id)!;
    assert.ok(snapshot.metadataPreview);
    snapshot.metadataPreview.embedded.title = 'mutado';
    snapshot.metadataPreview.effective.artist = 'mutado';
    snapshot.metadataPreview.fieldStates.album = 'missing';
    assert.equal(item.queue.get(item.job.id)?.metadataPreview?.embedded.title, 'Título local');
    assert.equal(item.queue.get(item.job.id)?.metadataPreview?.effective.artist, 'Artista local');
    assert.equal(item.queue.get(item.job.id)?.metadataPreview?.fieldStates.album, 'trusted');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
