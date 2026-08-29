import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportSafeDestinationManager } from './import-safe-destination.js';
import { ImportStagingManager } from './import-staging.js';

test('erro inesperado após promoção física não transforma arquivo já gravado em retryable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-post-promote-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);

  try {
    const queue = new ImportJobQueue();
    const staging = new ImportStagingManager({ stagingRoot, musicDir });
    const job = queue.enqueue({ type: 'upload', provider: null }, 'faixa.flac');
    await staging.createJob(job.id);
    await staging.writePayload(job.id, [Buffer.from('audio-promovido')]);
    queue.setMediaDecision(job.id, {
      profile: 'original',
      action: 'preserve',
      reason: 'original-compatible',
      selectedAudioStream: 0,
      input: {
        container: 'flac', codec: 'flac', durationSeconds: 10,
        bitRate: 700_000, sampleRate: 48_000, channels: 2,
        audioStreams: 1, videoStreams: 0
      },
      output: { container: 'flac', codec: 'flac', extension: '.flac', bitRate: 700_000 }
    });
    queue.setMetadataPreview(job.id, {
      embedded: { title: 'Faixa', artist: 'Artista', album: 'Álbum', albumArtist: 'Artista' },
      provider: null,
      overrides: { title: null, artist: null, album: null, albumArtist: null },
      effective: { title: 'Faixa', artist: 'Artista', album: 'Álbum', albumArtist: 'Artista' },
      fieldStates: { title: 'trusted', artist: 'trusted', album: 'trusted', albumArtist: 'trusted' },
      durationSeconds: 10,
      cover: { available: false, contentType: null, sizeBytes: null },
      generatedAt: '2026-08-29T12:00:00.000Z'
    });
    const validated = await staging.validatePayload(job.id, () => true);
    const manager = new ImportSafeDestinationManager({
      queue,
      staging,
      validatedLookup: id => id === job.id ? validated : null,
      duplicateReady: () => true,
      afterPromote: async () => {
        throw new Error('falha inesperada no consumidor pós-promoção');
      },
      musicDir
    });

    const result = await manager.promote(job.id);
    assert.equal(result.job.status, 'completed');
    assert.equal(queue.get(job.id)?.status, 'completed');
    assert.equal(staging.hasJob(job.id), false);
    const promoted = manager.getPromoted(job.id);
    assert.ok(promoted);
    assert.equal(await readFile(promoted.absolutePath, 'utf8'), 'audio-promovido');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
