import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  ImportDuplicateDetectionManager,
  type ImportDuplicateLibraryTrack
} from './import-duplicate-detection.js';

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function mediaDecision(durationSeconds = 180) {
  return {
    profile: 'original' as const,
    action: 'preserve' as const,
    reason: 'original-compatible' as const,
    selectedAudioStream: 0,
    input: {
      container: 'flac',
      codec: 'flac',
      durationSeconds,
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
  };
}

function metadataPreview(options: {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  durationSeconds?: number;
} = {}) {
  const effective = {
    title: options.title ?? 'Faixa teste',
    artist: options.artist ?? 'Artista teste',
    album: options.album ?? 'Álbum teste',
    albumArtist: options.artist ?? 'Artista teste'
  };
  return {
    embedded: { ...effective },
    provider: null,
    overrides: { title: null, artist: null, album: null, albumArtist: null },
    effective,
    fieldStates: {
      title: 'trusted' as const,
      artist: 'trusted' as const,
      album: 'trusted' as const,
      albumArtist: 'trusted' as const
    },
    durationSeconds: options.durationSeconds ?? 180,
    cover: { available: false, contentType: null, sizeBytes: null },
    generatedAt: '2026-08-29T12:00:00.000Z'
  };
}

async function fixture(options: {
  sourceBytes?: Buffer;
  validatedBytes?: Buffer;
  tracks?: ImportDuplicateLibraryTrack[];
  metadata?: ReturnType<typeof metadataPreview>;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-duplicate-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const job = queue.enqueue({ type: 'upload', provider: null }, 'Faixa teste.flac');
  const sourceBytes = options.sourceBytes ?? Buffer.from('source-audio');
  const validatedBytes = options.validatedBytes ?? sourceBytes;
  await staging.createJob(job.id);
  await staging.writePayload(job.id, [sourceBytes]);
  queue.setMediaDecision(job.id, mediaDecision(options.metadata?.durationSeconds));
  queue.setMetadataPreview(job.id, options.metadata ?? metadataPreview());
  const validated = {
    jobId: job.id,
    token: 'validated-token',
    size: validatedBytes.byteLength,
    sha256: sha256(validatedBytes),
    validation: {}
  };
  const manager = new ImportDuplicateDetectionManager({
    queue,
    staging,
    validatedLookup: () => validated,
    libraryTracks: () => options.tracks ?? [],
    musicDir,
    now: () => new Date('2026-08-29T12:30:00.000Z')
  });
  return { root, musicDir, queue, staging, job, manager };
}

async function libraryTrack(
  musicDir: string,
  fileName: string,
  bytes: Buffer,
  overrides: Partial<ImportDuplicateLibraryTrack> = {}
): Promise<ImportDuplicateLibraryTrack> {
  const filePath = path.join(musicDir, fileName);
  await writeFile(filePath, bytes);
  const info = await stat(filePath);
  return {
    id: overrides.id ?? `track-${fileName}`,
    filePath,
    title: overrides.title ?? 'Faixa teste',
    artist: overrides.artist ?? 'Artista teste',
    album: overrides.album ?? 'Álbum teste',
    albumArtist: overrides.albumArtist ?? 'Artista teste',
    duration: overrides.duration ?? 180,
    format: overrides.format ?? 'FLAC',
    fileSize: info.size,
    mtimeMs: info.mtimeMs
  };
}

test('bloqueia duplicata exata usando fingerprint capturado antes de conversão', async () => {
  const source = Buffer.from('audio-original-identico');
  const converted = Buffer.from('audio-convertido-diferente');
  const item = await fixture({ sourceBytes: source, validatedBytes: converted });
  try {
    const existing = await libraryTrack(item.musicDir, 'existente.flac', source);
    const manager = new ImportDuplicateDetectionManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => ({
        jobId: item.job.id,
        token: 'validated-token',
        size: converted.byteLength,
        sha256: sha256(converted),
        validation: {}
      }),
      libraryTracks: () => [existing],
      musicDir: item.musicDir,
      now: () => new Date('2026-08-29T12:30:00.000Z')
    });

    await manager.captureSource(item.job.id);
    const check = await manager.detect(item.job.id);
    assert.equal(check.confidence, 'exact');
    assert.equal(check.disposition, 'blocked');
    assert.equal(check.hashCompared, true);
    assert.equal(check.matches.length, 1);
    assert.deepEqual(check.matches[0].reasons, ['hash']);
    assert.equal(manager.isReady(item.job.id), false);
    assert.throws(() => manager.review(item.job.id), /não possui duplicata provável/i);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('classifica metadata + duração compatíveis como provável e exige revisão manual', async () => {
  const item = await fixture();
  try {
    const existing = await libraryTrack(item.musicDir, 'outra-encode.mp3', Buffer.from('outro-conteudo-maior'), {
      title: 'Faixa Teste',
      artist: 'Artísta teste',
      album: 'Álbum teste',
      duration: 181.5,
      format: 'MP3'
    });
    const manager = new ImportDuplicateDetectionManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => ({
        jobId: item.job.id,
        token: 'validated-token',
        size: 12,
        sha256: sha256('nao-igual'),
        validation: {}
      }),
      libraryTracks: () => [existing],
      hashLibraryTrack: async () => sha256('outro-arquivo'),
      now: () => new Date('2026-08-29T12:30:00.000Z')
    });

    const check = await manager.detect(item.job.id);
    assert.equal(check.confidence, 'probable');
    assert.equal(check.disposition, 'review');
    assert.equal(check.reviewedAt, null);
    assert.equal(manager.isReady(item.job.id), false);
    assert.ok(check.matches[0].reasons.includes('title'));
    assert.ok(check.matches[0].reasons.includes('artist'));
    assert.ok(check.matches[0].reasons.includes('duration'));

    const reviewed = manager.review(item.job.id);
    assert.equal(reviewed.reviewedAt, '2026-08-29T12:30:00.000Z');
    assert.equal(manager.isReady(item.job.id), true);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('não bloqueia falso positivo com mesmo título e duração mas artista diferente', async () => {
  const item = await fixture();
  try {
    const candidate: ImportDuplicateLibraryTrack = {
      id: 'track-falso',
      filePath: '/nao-usado/faixa.mp3',
      title: 'Faixa teste',
      artist: 'Outro artista',
      album: 'Outro álbum',
      albumArtist: 'Outro artista',
      duration: 180.8,
      format: 'MP3',
      fileSize: 99,
      mtimeMs: 1
    };
    const manager = new ImportDuplicateDetectionManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => ({
        jobId: item.job.id,
        token: 'validated-token',
        size: 12,
        sha256: sha256('nao-igual'),
        validation: {}
      }),
      libraryTracks: () => [candidate],
      now: () => new Date('2026-08-29T12:30:00.000Z')
    });

    const check = await manager.detect(item.job.id);
    assert.equal(check.confidence, 'possible');
    assert.equal(check.disposition, 'notice');
    assert.equal(manager.isReady(item.job.id), true);
    assert.equal(check.matches[0].confidence, 'possible');
    assert.deepEqual([...check.matches[0].reasons].sort(), ['duration', 'filename', 'title']);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('invalidar o check preserva fingerprint da origem no mesmo manager', async () => {
  const source = Buffer.from('fingerprint-preservado');
  const converted = Buffer.from('saida-transformada');
  const item = await fixture({ sourceBytes: source, validatedBytes: converted });
  const tracks: ImportDuplicateLibraryTrack[] = [];
  try {
    const manager = new ImportDuplicateDetectionManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => ({
        jobId: item.job.id,
        token: 'validated-token',
        size: converted.byteLength,
        sha256: sha256(converted),
        validation: {}
      }),
      libraryTracks: () => tracks,
      musicDir: item.musicDir
    });

    await manager.captureSource(item.job.id);
    const first = await manager.detect(item.job.id);
    assert.equal(first.confidence, 'none');
    manager.forgetCheck(item.job.id);
    assert.equal(manager.get(item.job.id), null);

    tracks.push(await libraryTrack(item.musicDir, 'igual.flac', source));
    const second = await manager.detect(item.job.id);
    assert.equal(second.confidence, 'exact');
    assert.equal(second.disposition, 'blocked');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('hash comparável indisponível nunca é apresentado como verificação limpa', async () => {
  const bytes = Buffer.from('mesmo-tamanho');
  const item = await fixture({ sourceBytes: bytes });
  try {
    const candidate: ImportDuplicateLibraryTrack = {
      id: 'track-indisponivel',
      filePath: '/arquivo/indisponivel.flac',
      title: 'Título totalmente diferente',
      artist: 'Outro artista',
      album: 'Outro álbum',
      albumArtist: 'Outro artista',
      duration: 999,
      format: 'FLAC',
      fileSize: bytes.byteLength,
      mtimeMs: 1
    };
    const manager = new ImportDuplicateDetectionManager({
      queue: item.queue,
      staging: item.staging,
      validatedLookup: () => ({
        jobId: item.job.id,
        token: 'validated-token',
        size: bytes.byteLength,
        sha256: sha256(bytes),
        validation: {}
      }),
      libraryTracks: () => [candidate],
      hashLibraryTrack: async () => null
    });

    const check = await manager.detect(item.job.id);
    assert.equal(check.confidence, 'none');
    assert.equal(check.disposition, 'notice');
    assert.equal(check.hashCompared, false);
    assert.equal(check.matches.length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
