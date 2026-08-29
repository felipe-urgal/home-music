import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  ImportSafeDestinationError,
  ImportSafeDestinationManager,
  normalizeImportFolderPath
} from './import-safe-destination.js';

async function fixture(options: { duplicateReady?: boolean; title?: string; artist?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-safe-destination-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir, { mode: 0o700 });
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const job = queue.enqueue({ type: 'upload', provider: null }, 'arquivo do usuário?.flac');
  await staging.createJob(job.id);
  await staging.writePayload(job.id, [Buffer.from('audio-validado')]);
  queue.setMediaDecision(job.id, {
    profile: 'original',
    action: 'preserve',
    reason: 'original-compatible',
    selectedAudioStream: 0,
    input: {
      container: 'flac', codec: 'flac', durationSeconds: 180,
      bitRate: 700_000, sampleRate: 48_000, channels: 2,
      audioStreams: 1, videoStreams: 0
    },
    output: { container: 'flac', codec: 'flac', extension: '.flac', bitRate: 700_000 }
  });
  queue.setMetadataPreview(job.id, {
    embedded: {
      title: options.title ?? 'Minha / Faixa: Teste?',
      artist: options.artist ?? 'Artista * Principal',
      album: 'Álbum',
      albumArtist: options.artist ?? 'Artista * Principal'
    },
    provider: null,
    overrides: { title: null, artist: null, album: null, albumArtist: null },
    effective: {
      title: options.title ?? 'Minha / Faixa: Teste?',
      artist: options.artist ?? 'Artista * Principal',
      album: 'Álbum',
      albumArtist: options.artist ?? 'Artista * Principal'
    },
    fieldStates: { title: 'trusted', artist: 'trusted', album: 'trusted', albumArtist: 'trusted' },
    durationSeconds: 180,
    cover: { available: false, contentType: null, sizeBytes: null },
    generatedAt: '2026-08-29T13:00:00.000Z'
  });
  const validated = await staging.validatePayload(job.id, () => true);
  const manager = new ImportSafeDestinationManager({
    queue,
    staging,
    validatedLookup: id => id === job.id ? validated : null,
    duplicateReady: () => options.duplicateReady ?? true,
    musicDir
  });
  return { root, musicDir, stagingRoot, queue, staging, job, validated, manager };
}

function permissions(mode: number) {
  return mode & 0o777;
}

test('gera nome previsível sanitizado e promove para Importados sem escapar de MUSIC_DIR', async () => {
  const item = await fixture();
  try {
    const plan = await item.manager.plan(item.job.id);
    assert.equal(plan.folderPath, 'Importados');
    assert.equal(plan.fileName, 'Artista Principal - Minha - Faixa Teste.flac');
    assert.equal(plan.relativePath, 'Importados/Artista Principal - Minha - Faixa Teste.flac');
    assert.equal(plan.collisionIndex, 1);
    assert.rejects(() => stat(path.join(item.musicDir, 'Importados')), { code: 'ENOENT' });

    const result = await item.manager.promote(item.job.id);
    assert.equal(result.job.status, 'completed');
    assert.equal(result.destination.relativePath, plan.relativePath);
    const finalPath = path.join(item.musicDir, ...result.destination.relativePath.split('/'));
    assert.equal(await readFile(finalPath, 'utf8'), 'audio-validado');
    assert.equal(permissions((await stat(finalPath)).mode), 0o640);
    assert.equal(item.staging.hasJob(item.job.id), false);
    assert.equal(item.manager.getPromoted(item.job.id)?.relativePath, result.destination.relativePath);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('resolve colisão sem sobrescrever arquivo existente', async () => {
  const item = await fixture({ title: 'Faixa', artist: 'Artista' });
  try {
    const folder = path.join(item.musicDir, 'Importados');
    await mkdir(folder);
    const existing = path.join(folder, 'Artista - Faixa.flac');
    await writeFile(existing, 'existente');

    const plan = await item.manager.plan(item.job.id);
    assert.equal(plan.fileName, 'Artista - Faixa (2).flac');
    assert.equal(plan.collisionIndex, 2);
    const result = await item.manager.promote(item.job.id);
    assert.equal(result.destination.fileName, 'Artista - Faixa (2).flac');
    assert.equal(await readFile(existing, 'utf8'), 'existente');
    assert.equal(await readFile(path.join(folder, result.destination.fileName), 'utf8'), 'audio-validado');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('aceita subpasta relativa e bloqueia traversal, absoluto, caracteres problemáticos e symlink', async () => {
  const item = await fixture();
  try {
    assert.deepEqual(normalizeImportFolderPath('Rock/Anos 90'), ['Rock', 'Anos 90']);
    for (const unsafe of ['../fora', '/absoluto', 'Rock/../fora', 'Rock\\fora', '.oculta', 'Rock/AUX', 'Rock/A:lha']) {
      assert.throws(
        () => normalizeImportFolderPath(unsafe),
        (error: unknown) => error instanceof ImportSafeDestinationError && error.code === 'invalid_destination'
      );
    }

    const outside = path.join(item.root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(item.musicDir, 'Atalho'));
    await assert.rejects(
      () => item.manager.plan(item.job.id, 'Atalho'),
      (error: unknown) => error instanceof ImportSafeDestinationError && error.code === 'invalid_destination'
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('não promove antes da revisão de duplicatas', async () => {
  const item = await fixture({ duplicateReady: false });
  try {
    await assert.rejects(
      () => item.manager.promote(item.job.id),
      (error: unknown) => error instanceof ImportSafeDestinationError && error.code === 'duplicates_not_ready'
    );
    assert.equal(item.queue.get(item.job.id)?.status, 'pending');
    assert.equal(item.staging.hasJob(item.job.id), true);
    assert.deepEqual(await readdir(item.musicDir), []);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('falha de promoção reverte diretório criado e marca job sem deixar arquivo parcial', async () => {
  const item = await fixture();
  try {
    const brokenManager = new ImportSafeDestinationManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => ({ ...item.validated, token: 'token-inválido' }),
      duplicateReady: () => true,
      musicDir: item.musicDir
    });
    await assert.rejects(
      () => brokenManager.promote(item.job.id, 'Nova/Pasta'),
      (error: unknown) => error instanceof ImportSafeDestinationError && error.code === 'promotion_failed'
    );
    assert.equal(item.queue.get(item.job.id)?.status, 'failed');
    await assert.rejects(() => stat(path.join(item.musicDir, 'Nova')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(item.musicDir), []);
    assert.equal(item.staging.hasJob(item.job.id), true);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
