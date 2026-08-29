import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportSafeDestinationManager } from './import-safe-destination.js';
import { ImportStagingManager, type ValidatedImportPayload } from './import-staging.js';

function mediaDecision() {
  return {
    profile: 'original' as const,
    action: 'preserve' as const,
    reason: 'original-compatible' as const,
    selectedAudioStream: 0,
    input: {
      container: 'flac', codec: 'flac', durationSeconds: 180,
      bitRate: 700_000, sampleRate: 48_000, channels: 2,
      audioStreams: 1, videoStreams: 0
    },
    output: { container: 'flac', codec: 'flac', extension: '.flac', bitRate: 700_000 }
  };
}

function metadataPreview() {
  return {
    embedded: { title: 'Faixa', artist: 'Artista', album: 'Álbum', albumArtist: 'Artista' },
    provider: null,
    overrides: { title: null, artist: null, album: null, albumArtist: null },
    effective: { title: 'Faixa', artist: 'Artista', album: 'Álbum', albumArtist: 'Artista' },
    fieldStates: { title: 'trusted' as const, artist: 'trusted' as const, album: 'trusted' as const, albumArtist: 'trusted' as const },
    durationSeconds: 180,
    cover: { available: false, contentType: null, sizeBytes: null },
    generatedAt: '2026-08-29T13:00:00.000Z'
  };
}

test('promoções concorrentes com o mesmo nome recebem destinos distintos sem overwrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-safe-destination-concurrency-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const validated = new Map<string, ValidatedImportPayload<unknown>>();

  async function createReadyJob(content: string) {
    const job = queue.enqueue({ type: 'upload', provider: null }, 'faixa.flac');
    await staging.createJob(job.id);
    await staging.writePayload(job.id, [Buffer.from(content)]);
    queue.setMediaDecision(job.id, mediaDecision());
    queue.setMetadataPreview(job.id, metadataPreview());
    validated.set(job.id, await staging.validatePayload(job.id, () => true));
    return job;
  }

  try {
    const first = await createReadyJob('primeiro');
    const second = await createReadyJob('segundo');
    const manager = new ImportSafeDestinationManager({
      queue,
      staging,
      validatedLookup: jobId => validated.get(jobId) ?? null,
      duplicateReady: () => true,
      musicDir
    });

    const [firstResult, secondResult] = await Promise.all([
      manager.promote(first.id),
      manager.promote(second.id)
    ]);

    assert.deepEqual(
      [firstResult.destination.fileName, secondResult.destination.fileName].sort(),
      ['Artista - Faixa (2).flac', 'Artista - Faixa.flac']
    );
    const files = (await readdir(path.join(musicDir, 'Importados'))).sort();
    assert.deepEqual(files, ['Artista - Faixa (2).flac', 'Artista - Faixa.flac']);
    assert.deepEqual(
      new Set([
        await readFile(path.join(musicDir, 'Importados', files[0]), 'utf8'),
        await readFile(path.join(musicDir, 'Importados', files[1]), 'utf8')
      ]),
      new Set(['primeiro', 'segundo'])
    );
    assert.equal(queue.get(first.id)?.status, 'completed');
    assert.equal(queue.get(second.id)?.status, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
