import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import {
  ImportMediaValidationError,
  ImportMediaValidationManager,
  decideImportMedia,
  parseMediaProbeJson,
  resolveFfprobeCommand,
  selectBestProviderAudioCandidate,
  type ImportMediaTranscodeRunner,
  type MediaProbeRunner
} from './import-media-validation.js';

function probeJson(options: {
  format?: string;
  duration?: number;
  bitRate?: number;
  video?: number;
  audio?: Array<{
    index?: number;
    codec?: string;
    bitRate?: number | null;
    sampleRate?: number | null;
    channels?: number | null;
    profile?: string | null;
  }>;
} = {}) {
  const audio = options.audio ?? [{ index: 0, codec: 'mp3', bitRate: 192_000, sampleRate: 44_100, channels: 2 }];
  return JSON.stringify({
    format: {
      format_name: options.format ?? 'mp3',
      duration: String(options.duration ?? 120),
      bit_rate: String(options.bitRate ?? audio[0]?.bitRate ?? 192_000)
    },
    streams: [
      ...audio.map(item => ({
        index: item.index ?? 0,
        codec_name: item.codec ?? 'mp3',
        codec_type: 'audio',
        profile: item.profile ?? undefined,
        bit_rate: item.bitRate == null ? undefined : String(item.bitRate),
        sample_rate: item.sampleRate == null ? undefined : String(item.sampleRate),
        channels: item.channels ?? undefined,
        duration: String(options.duration ?? 120)
      })),
      ...Array.from({ length: options.video ?? 0 }, (_, index) => ({
        index: 20 + index,
        codec_name: 'h264',
        codec_type: 'video'
      }))
    ]
  });
}

async function fixture(options: {
  probes?: string[];
  transcodeRunner?: ImportMediaTranscodeRunner;
  payload?: string;
  timeoutMs?: number;
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-media-validation-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const job = queue.enqueue({ type: 'upload', provider: null }, 'faixa-importada.mp3');
  await staging.createJob(job.id);
  await staging.writePayload(job.id, [Buffer.from(options.payload ?? 'source-audio')]);

  const probes = [...(options.probes ?? [probeJson(), probeJson()])];
  const probeCalls: Array<{ command: string; fd: number; size: number }> = [];
  const probeRunner: MediaProbeRunner = async (command, target) => {
    probeCalls.push({ command, fd: target.fd, size: target.size });
    const next = probes.shift();
    if (next == null) throw new Error('probe fake sem resposta');
    return next;
  };
  const transcodeCalls: Array<Parameters<ImportMediaTranscodeRunner>[0]> = [];
  const transcodeRunner: ImportMediaTranscodeRunner = options.transcodeRunner ?? (async call => {
    transcodeCalls.push(call);
    await writeFile(call.outputPath, Buffer.from('converted-audio'));
  });
  const manager = new ImportMediaValidationManager({
    queue,
    staging,
    ffmpegCommand: '/opt/ffmpeg/bin/ffmpeg',
    ffprobeCommand: '/opt/ffmpeg/bin/ffprobe',
    timeoutMs: options.timeoutMs ?? 1_234,
    probeRunner,
    transcodeRunner
  });

  return { root, musicDir, stagingRoot, queue, staging, job, manager, probeCalls, transcodeCalls };
}

test('parseia ffprobe, duração e escolhe a melhor faixa de áudio', () => {
  const parsed = parseMediaProbeJson(probeJson({
    format: 'matroska,webm',
    duration: 245.5,
    audio: [
      { index: 1, codec: 'aac', bitRate: 256_000, sampleRate: 48_000, channels: 2 },
      { index: 2, codec: 'flac', bitRate: 800_000, sampleRate: 96_000, channels: 2 },
      { index: 3, codec: 'opus', bitRate: 320_000, sampleRate: 48_000, channels: 6 }
    ]
  }));

  assert.deepEqual(parsed.formatNames, ['matroska', 'webm']);
  assert.equal(parsed.durationSeconds, 245.5);
  assert.equal(parsed.audioStreams.length, 3);
  assert.equal(parsed.selectedAudioStream.index, 2);
  assert.equal(parsed.selectedAudioStream.codec, 'flac');
  assert.equal(parsed.selectedAudioStream.lossless, true);
});

test('rejeita JSON corrompido, ausência de áudio e duração inválida', () => {
  assert.throws(() => parseMediaProbeJson('{'), /dados técnicos inválidos/);
  assert.throws(() => parseMediaProbeJson(JSON.stringify({
    format: { format_name: 'mp3', duration: '120' },
    streams: [{ index: 0, codec_name: 'h264', codec_type: 'video' }]
  })), /faixa de áudio válida/);
  assert.throws(() => parseMediaProbeJson(probeJson({ duration: 0 })), /faixa de áudio válida/);
});

test('seleciona melhor fonte de provider de forma determinística', () => {
  const selected = selectBestProviderAudioCandidate([
    { id: 'video-320', codec: 'aac', bitRate: 320_000, audioOnly: false, channels: 2 },
    { id: 'audio-256', codec: 'aac', bitRate: 256_000, audioOnly: true, channels: 2 },
    { id: 'audio-lossless', codec: 'flac', bitRate: 700_000, audioOnly: true, channels: 2, lossless: true }
  ]);
  assert.equal(selected?.id, 'audio-lossless');
  assert.equal(selectBestProviderAudioCandidate([]), null);
});

test('resolve ffprobe explícito e deriva binário ao lado de ffmpeg customizado', () => {
  assert.equal(resolveFfprobeCommand('/custom/ffprobe', '/custom/ffmpeg'), '/custom/ffprobe');
  assert.equal(resolveFfprobeCommand(undefined, '/opt/media/bin/ffmpeg'), '/opt/media/bin/ffprobe');
  assert.equal(resolveFfprobeCommand(undefined, 'ffmpeg'), 'ffprobe');
  assert.throws(() => resolveFfprobeCommand(`bad\0probe`, 'ffmpeg'));
});

test('perfil original preserva MP3 compatível sem executar transcode', async () => {
  const input = probeJson({ format: 'mp3', bitRate: 192_000 });
  const item = await fixture({ probes: [input, input] });
  try {
    const result = await item.manager.validate(item.job.id, 'original');
    assert.equal(result.job.status, 'pending');
    assert.equal(result.validation.action, 'preserve');
    assert.equal(result.validation.reason, 'original-compatible');
    assert.equal(result.validation.output.extension, '.mp3');
    assert.equal(item.transcodeCalls.length, 0);
    assert.equal(item.probeCalls.length, 2);
    assert.ok(item.probeCalls.every(call => call.fd >= 0));
    assert.ok(item.manager.getValidated(item.job.id));
    assert.equal((await readdir(item.musicDir)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('economia preserva arquivo já econômico e evita reencode desnecessário', async () => {
  const input = probeJson({ format: 'ogg', bitRate: 96_000, audio: [
    { index: 0, codec: 'opus', bitRate: 96_000, sampleRate: 48_000, channels: 2 }
  ] });
  const item = await fixture({ probes: [input, input] });
  try {
    const result = await item.manager.validate(item.job.id, 'economy');
    assert.equal(result.validation.action, 'preserve');
    assert.equal(result.validation.reason, 'already-economical');
    assert.equal(result.validation.output.extension, '.opus');
    assert.equal(item.transcodeCalls.length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('economia converte origem de bitrate alto para AAC 96k e reprobeia saída', async () => {
  const source = probeJson({ format: 'flac', bitRate: 900_000, audio: [
    { index: 0, codec: 'flac', bitRate: 900_000, sampleRate: 96_000, channels: 2 }
  ] });
  const output = probeJson({ format: 'mov,mp4,m4a,3gp,3g2,mj2', bitRate: 98_000, audio: [
    { index: 0, codec: 'aac', bitRate: 96_000, sampleRate: 48_000, channels: 2, profile: 'LC' }
  ] });
  const item = await fixture({ probes: [source, output] });
  try {
    const result = await item.manager.validate(item.job.id, 'economy');
    assert.equal(result.validation.action, 'transcode');
    assert.equal(result.validation.reason, 'economy-requested');
    assert.equal(result.validation.output.codec, 'aac');
    assert.equal(result.validation.output.extension, '.m4a');
    assert.equal(result.validation.output.bitRate, 96_000);
    assert.equal(item.transcodeCalls.length, 1);
    assert.equal(item.transcodeCalls[0].bitRate, 96_000);
    assert.equal(item.transcodeCalls[0].streamIndex, 0);
    assert.equal(item.transcodeCalls[0].timeoutMs, 1_234);
    assert.equal((await readdir(item.stagingRoot)).length, 1);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('compatibilidade preserva M4A/AAC estéreo já compatível', async () => {
  const input = probeJson({ format: 'mov,mp4,m4a,3gp,3g2,mj2', bitRate: 160_000, audio: [
    { index: 0, codec: 'aac', bitRate: 160_000, sampleRate: 44_100, channels: 2, profile: 'LC' }
  ] });
  const item = await fixture({ probes: [input, input] });
  try {
    const result = await item.manager.validate(item.job.id, 'compatibility');
    assert.equal(result.validation.action, 'preserve');
    assert.equal(result.validation.reason, 'already-compatible');
    assert.equal(item.transcodeCalls.length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('original converte container incompatível e seleciona melhor áudio quando há múltiplas faixas', async () => {
  const source = probeJson({ format: 'matroska,webm', bitRate: 800_000, audio: [
    { index: 1, codec: 'aac', bitRate: 256_000, sampleRate: 48_000, channels: 2 },
    { index: 2, codec: 'flac', bitRate: 700_000, sampleRate: 96_000, channels: 2 }
  ] });
  const output = probeJson({ format: 'mov,mp4,m4a,3gp,3g2,mj2', bitRate: 164_000, audio: [
    { index: 0, codec: 'aac', bitRate: 160_000, sampleRate: 48_000, channels: 2 }
  ] });
  const item = await fixture({ probes: [source, output] });
  try {
    const result = await item.manager.validate(item.job.id, 'original');
    assert.equal(result.validation.action, 'transcode');
    assert.equal(result.validation.reason, 'multiple-audio-streams');
    assert.equal(result.validation.selectedAudioStream, 2);
    assert.equal(item.transcodeCalls[0].streamIndex, 2);
    assert.equal(item.transcodeCalls[0].bitRate, 160_000);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('arquivo com vídeo nunca é preservado pelo perfil original', () => {
  const probe = parseMediaProbeJson(probeJson({ video: 1 }));
  const decision = decideImportMedia('original', probe);
  assert.equal(decision.action, 'transcode');
  assert.equal(decision.reason, 'contains-video');
  assert.equal(decision.output.extension, '.m4a');
});

test('falha de transcode é canonicalizada, registrada no job e limpa staging', async () => {
  const source = probeJson({ format: 'flac', bitRate: 900_000, audio: [
    { codec: 'flac', bitRate: 900_000, sampleRate: 96_000, channels: 2 }
  ] });
  const item = await fixture({
    probes: [source],
    transcodeRunner: async () => { throw new Error('segredo interno ffmpeg /etc/passwd'); }
  });
  try {
    await assert.rejects(
      () => item.manager.validate(item.job.id, 'economy'),
      (error: unknown) => error instanceof ImportMediaValidationError && error.code === 'transcode_failed'
    );
    const failed = item.queue.get(item.job.id)!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'FFmpeg não conseguiu converter a mídia importada.');
    assert.equal(failed.error.includes('segredo'), false);
    assert.equal(failed.mediaDecision?.action, 'transcode');
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('mídia corrompida falha antes de qualquer transcode', async () => {
  const item = await fixture({ probes: ['{'] });
  try {
    await assert.rejects(
      () => item.manager.validate(item.job.id, 'original'),
      (error: unknown) => error instanceof ImportMediaValidationError && error.code === 'invalid_media'
    );
    assert.equal(item.queue.get(item.job.id)?.status, 'failed');
    assert.equal(item.transcodeCalls.length, 0);
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('reprobe rejeita saída incompatível ou com duração truncada', async () => {
  const source = probeJson({ format: 'flac', duration: 120, bitRate: 900_000, audio: [
    { codec: 'flac', bitRate: 900_000, sampleRate: 96_000, channels: 2 }
  ] });
  const truncated = probeJson({ format: 'mov,mp4,m4a', duration: 60, bitRate: 160_000, audio: [
    { codec: 'aac', bitRate: 160_000, sampleRate: 48_000, channels: 2 }
  ] });
  const item = await fixture({ probes: [source, truncated] });
  try {
    await assert.rejects(
      () => item.manager.validate(item.job.id, 'compatibility'),
      (error: unknown) => error instanceof ImportMediaValidationError && error.code === 'invalid_media'
    );
    assert.equal(item.queue.get(item.job.id)?.status, 'failed');
    assert.equal((await readdir(item.stagingRoot)).length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('perfil inválido e job fora de pending são recusados sem executar probe', async () => {
  const item = await fixture();
  try {
    await assert.rejects(
      () => item.manager.validate(item.job.id, 'ultra'),
      (error: unknown) => error instanceof ImportMediaValidationError && error.code === 'invalid_profile'
    );
    assert.equal(item.probeCalls.length, 0);

    item.queue.transition(item.job.id, 'processing');
    await assert.rejects(
      () => item.manager.validate(item.job.id, 'original'),
      (error: unknown) => error instanceof ImportMediaValidationError && error.code === 'job_not_ready'
    );
    assert.equal(item.probeCalls.length, 0);
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});

test('decisão técnica fica defensiva dentro do job', async () => {
  const input = probeJson();
  const item = await fixture({ probes: [input, input] });
  try {
    await item.manager.validate(item.job.id, 'original');
    const snapshot = item.queue.get(item.job.id)!;
    assert.ok(snapshot.mediaDecision);
    snapshot.mediaDecision.input.codec = 'mutado';
    snapshot.mediaDecision.output.extension = '.exe';
    assert.equal(item.queue.get(item.job.id)?.mediaDecision?.input.codec, 'mp3');
    assert.equal(item.queue.get(item.job.id)?.mediaDecision?.output.extension, '.mp3');
  } finally {
    await rm(item.root, { recursive: true, force: true });
  }
});
