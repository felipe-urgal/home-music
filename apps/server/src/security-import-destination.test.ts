import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import {
  ImportSafeDestinationError,
  ImportSafeDestinationManager
} from './import-safe-destination.js';
import { ImportStagingManager } from './import-staging.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-import-destination-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir, { mode: 0o700 });

  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const job = queue.enqueue({ type: 'upload', provider: null }, 'entrada.flac');
  await staging.createJob(job.id);
  await staging.writePayload(job.id, [Buffer.from('audio-validado')]);
  queue.setMediaDecision(job.id, {
    profile: 'original',
    action: 'preserve',
    reason: 'original-compatible',
    selectedAudioStream: 0,
    input: {
      container: 'flac',
      codec: 'flac',
      durationSeconds: 180,
      bitRate: 700_000,
      sampleRate: 48_000,
      channels: 2,
      audioStreams: 1,
      videoStreams: 0
    },
    output: {
      container: 'flac',
      codec: 'flac',
      extension: '.flac',
      bitRate: 700_000
    }
  });
  queue.setMetadataPreview(job.id, {
    embedded: {
      title: 'Faixa',
      artist: 'Artista',
      album: 'Álbum',
      albumArtist: 'Artista'
    },
    provider: null,
    overrides: { title: null, artist: null, album: null, albumArtist: null },
    effective: {
      title: 'Faixa',
      artist: 'Artista',
      album: 'Álbum',
      albumArtist: 'Artista'
    },
    fieldStates: {
      title: 'trusted',
      artist: 'trusted',
      album: 'trusted',
      albumArtist: 'trusted'
    },
    durationSeconds: 180,
    cover: { available: false, contentType: null, sizeBytes: null },
    generatedAt: '2026-08-31T20:00:00.000Z'
  });
  const validated = await staging.validatePayload(job.id, () => true);
  const manager = new ImportSafeDestinationManager({
    queue,
    staging,
    validatedLookup: id => id === job.id ? validated : null,
    duplicateReady: () => true,
    musicDir
  });

  return { root, musicDir, staging, queue, job, manager };
}

test('destino de importação bloqueia traversal e symlink sem tocar fora de MUSIC_DIR', async () => {
  const item = await fixture();
  try {
    for (const unsafe of ['../fora', '/absoluto', 'Rock/../fora', 'Rock\\fora', '.oculta']) {
      await assert.rejects(
        () => item.manager.plan(item.job.id, unsafe),
        (error: unknown) =>
          error instanceof ImportSafeDestinationError
          && error.code === 'invalid_destination',
        unsafe
      );
    }

    const outside = path.join(item.root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(item.musicDir, 'Escape'));
    await assert.rejects(
      () => item.manager.plan(item.job.id, 'Escape'),
      (error: unknown) =>
        error instanceof ImportSafeDestinationError
        && error.code === 'invalid_destination'
    );

    assert.deepEqual(await readdir(outside), []);
    assert.equal(item.staging.hasJob(item.job.id), true);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('colisão de destino nunca sobrescreve a mídia existente', async () => {
  const item = await fixture();
  try {
    const destinationDir = path.join(item.musicDir, 'Importados');
    await mkdir(destinationDir);
    const existing = path.join(destinationDir, 'Artista - Faixa.flac');
    await writeFile(existing, 'arquivo-existente');

    const plan = await item.manager.plan(item.job.id);
    assert.equal(plan.fileName, 'Artista - Faixa (2).flac');

    const promoted = await item.manager.promote(item.job.id);
    assert.equal(promoted.destination.fileName, 'Artista - Faixa (2).flac');
    assert.equal(await readFile(existing, 'utf8'), 'arquivo-existente');
    assert.equal(
      await readFile(path.join(destinationDir, promoted.destination.fileName), 'utf8'),
      'audio-validado'
    );
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
