import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  ImportMediaDecision,
  ImportMediaDecisionReason,
  ImportMediaTechnicalInfo,
  ImportOutputProfile
} from '@home-music/shared';
import { resolveFfmpegCommand } from './ffmpeg.js';
import type { ImportJobQueue } from './import-job-queue.js';
import type {
  ImportStagingManager,
  ImportValidationTarget,
  ValidatedImportPayload
} from './import-staging.js';

export const DEFAULT_FFPROBE_COMMAND = 'ffprobe';
export const DEFAULT_IMPORT_MEDIA_TIMEOUT_MS = 120_000;
const PROBE_MAX_OUTPUT_BYTES = 256 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const FFMPEG_MAX_STDERR_BYTES = 64 * 1024;
const SAFE_DEMUXERS = 'aac,flac,matroska,webm,mov,mp3,ogg,wav';
const SAFE_PROTOCOLS = 'file,pipe';
const ECONOMY_BITRATE = 96_000;
const ECONOMY_PRESERVE_THRESHOLD = 112_000;
const COMPATIBILITY_BITRATE = 160_000;
const LOSSLESS_CODECS = new Set(['alac', 'ape', 'flac', 'wavpack']);

type ImportMediaMuxer = 'flac' | 'mp3' | 'mp4' | 'ogg' | 'wav';

type RemuxTarget = Readonly<{
  container: string;
  extension: string;
  muxer: ImportMediaMuxer;
}>;

export const IMPORT_OUTPUT_PROFILES: ReadonlyArray<{
  id: ImportOutputProfile;
  label: string;
  description: string;
}> = [
  {
    id: 'original',
    label: 'Original',
    description: 'Preserva codec e qualidade; apenas limpa o container sem reencode quando necessário.'
  },
  {
    id: 'economy',
    label: 'Economizar espaço',
    description: 'Preserva uma origem já econômica ou usa AAC 96 kbps quando precisa reduzir tamanho.'
  },
  {
    id: 'compatibility',
    label: 'Compatibilidade máxima',
    description: 'Produz M4A/AAC 160 kbps somente quando a origem ainda não pode ser reaproveitada.'
  }
] as const;

export type ImportAudioCandidate = Readonly<{
  id: string;
  codec?: string | null;
  container?: string | null;
  bitRate?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  audioOnly?: boolean;
  lossless?: boolean;
}>;

export type MediaProbeAudioStream = Readonly<{
  index: number;
  codec: string;
  profile: string | null;
  bitRate: number | null;
  sampleRate: number | null;
  channels: number | null;
  durationSeconds: number | null;
  lossless: boolean;
}>;

export type MediaProbeResult = Readonly<{
  formatNames: readonly string[];
  durationSeconds: number;
  bitRate: number | null;
  audioStreams: readonly MediaProbeAudioStream[];
  videoStreams: number;
  selectedAudioStream: MediaProbeAudioStream;
}>;

type FfprobeJson = {
  format?: {
    format_name?: unknown;
    duration?: unknown;
    bit_rate?: unknown;
  };
  streams?: Array<{
    index?: unknown;
    codec_name?: unknown;
    codec_type?: unknown;
    profile?: unknown;
    sample_rate?: unknown;
    channels?: unknown;
    duration?: unknown;
    bit_rate?: unknown;
  }>;
};

export type MediaProbeRunner = (
  command: string,
  target: ImportValidationTarget,
  timeoutMs: number
) => Promise<string>;

export type ImportMediaTransformRunner = (options: {
  command: string;
  inputFd: number;
  outputPath: string;
  streamIndex: number;
  mode: 'copy' | 'aac';
  muxer: ImportMediaMuxer;
  bitRate: number | null;
  channels: number | null;
  sampleRate: number | null;
  timeoutMs: number;
}) => Promise<void>;

export type ImportMediaValidationErrorCode =
  | 'invalid_profile'
  | 'job_not_found'
  | 'job_not_ready'
  | 'already_validated'
  | 'probe_unavailable'
  | 'probe_timeout'
  | 'invalid_media'
  | 'transcode_unavailable'
  | 'transcode_timeout'
  | 'transcode_failed';

export class ImportMediaValidationError extends Error {
  constructor(
    public readonly code: ImportMediaValidationErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ImportMediaValidationError';
  }
}

class MediaProcessError extends Error {
  constructor(
    public readonly reason: 'spawn' | 'timeout' | 'failed' | 'overflow' | 'invalid-output',
    message: string,
    public readonly systemCode = ''
  ) {
    super(message);
    this.name = 'MediaProcessError';
  }
}

type ImportMediaValidationManagerOptions = {
  queue: ImportJobQueue;
  staging: ImportStagingManager;
  ffmpegCommand?: string;
  ffprobeCommand?: string;
  timeoutMs?: number;
  probeRunner?: MediaProbeRunner;
  transformRunner?: ImportMediaTransformRunner;
};

function cleanCommand(raw: string | undefined, fallback: string, name: string) {
  const value = raw?.trim() || fallback;
  if (value.includes('\0') || value.length > 1_024) {
    throw new ImportMediaValidationError('probe_unavailable', `${name} está configurado de forma inválida.`, 503);
  }
  return value;
}

export function resolveFfprobeCommand(rawFfprobe: string | undefined, rawFfmpeg?: string) {
  if (rawFfprobe?.trim()) return cleanCommand(rawFfprobe, DEFAULT_FFPROBE_COMMAND, 'FFprobe');
  const ffmpeg = resolveFfmpegCommand(rawFfmpeg);
  if (ffmpeg.includes('/') || ffmpeg.includes('\\')) {
    return path.join(path.dirname(ffmpeg), 'ffprobe');
  }
  return DEFAULT_FFPROBE_COMMAND;
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value: unknown) {
  const parsed = parseNumber(value);
  return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function codecIsLossless(codec: string) {
  return LOSSLESS_CODECS.has(codec) || codec.startsWith('pcm_');
}

function scoreAudioCandidate(candidate: ImportAudioCandidate) {
  return [
    candidate.audioOnly === false ? 0 : 1,
    candidate.lossless || (candidate.codec ? codecIsLossless(candidate.codec.toLowerCase()) : false) ? 1 : 0,
    candidate.bitRate ?? 0,
    candidate.channels ?? 0,
    candidate.sampleRate ?? 0
  ] as const;
}

function compareScore(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function selectBestProviderAudioCandidate<T extends ImportAudioCandidate>(candidates: readonly T[]) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const score = compareScore(scoreAudioCandidate(left), scoreAudioCandidate(right));
    return score || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function selectBestAudioStream(streams: readonly MediaProbeAudioStream[]) {
  const candidates = streams.map(stream => ({
    id: String(stream.index),
    codec: stream.codec,
    bitRate: stream.bitRate,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    audioOnly: true,
    lossless: stream.lossless,
    stream
  }));
  return selectBestProviderAudioCandidate(candidates)?.stream ?? null;
}

export function parseMediaProbeJson(raw: string): MediaProbeResult {
  let payload: FfprobeJson;
  try {
    payload = JSON.parse(raw) as FfprobeJson;
  } catch {
    throw new ImportMediaValidationError('invalid_media', 'FFprobe retornou dados técnicos inválidos.', 422);
  }

  const formatNames = typeof payload.format?.format_name === 'string'
    ? payload.format.format_name.split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
    : [];
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const audioStreams: MediaProbeAudioStream[] = [];
  let videoStreams = 0;

  for (const stream of streams) {
    const type = typeof stream.codec_type === 'string' ? stream.codec_type.toLowerCase() : '';
    if (type === 'video') {
      videoStreams += 1;
      continue;
    }
    if (type !== 'audio') continue;

    const index = parseNumber(stream.index);
    const codec = typeof stream.codec_name === 'string' ? stream.codec_name.trim().toLowerCase() : '';
    if (index == null || !Number.isInteger(index) || index < 0 || !codec) continue;
    audioStreams.push({
      index,
      codec,
      profile: typeof stream.profile === 'string' && stream.profile.trim() ? stream.profile.trim() : null,
      bitRate: parsePositiveInteger(stream.bit_rate),
      sampleRate: parsePositiveInteger(stream.sample_rate),
      channels: parsePositiveInteger(stream.channels),
      durationSeconds: parseNumber(stream.duration),
      lossless: codecIsLossless(codec)
    });
  }

  const selectedAudioStream = selectBestAudioStream(audioStreams);
  const durationSeconds = parseNumber(payload.format?.duration) ?? selectedAudioStream?.durationSeconds ?? null;
  if (formatNames.length === 0 || !selectedAudioStream || durationSeconds == null || durationSeconds <= 0) {
    throw new ImportMediaValidationError('invalid_media', 'A mídia não possui uma faixa de áudio válida com duração reconhecida.', 422);
  }

  return {
    formatNames,
    durationSeconds,
    bitRate: parsePositiveInteger(payload.format?.bit_rate),
    audioStreams,
    videoStreams,
    selectedAudioStream
  };
}

function appendLimited(current: string, chunk: Buffer, maxBytes: number) {
  const next = `${current}${chunk.toString('utf8')}`;
  if (Buffer.byteLength(next, 'utf8') > maxBytes) {
    throw new MediaProcessError('overflow', 'Saída do processo excedeu o limite permitido.');
  }
  return next;
}

export const runFfprobe: MediaProbeRunner = (command, target, timeoutMs) => new Promise((resolve, reject) => {
  const args = [
    '-v', 'error',
    '-protocol_whitelist', SAFE_PROTOCOLS,
    '-format_whitelist', SAFE_DEMUXERS,
    '-show_entries', 'format=format_name,duration,bit_rate:stream=index,codec_name,codec_type,profile,sample_rate,channels,duration,bit_rate',
    '-of', 'json',
    '/proc/self/fd/3'
  ];
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe', target.fd],
    windowsHide: true
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(stdout);
  };

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  timer.unref?.();

  child.stdout?.on('data', chunk => {
    try {
      stdout = appendLimited(stdout, Buffer.from(chunk), PROBE_MAX_OUTPUT_BYTES);
    } catch (error) {
      child.kill('SIGKILL');
      finish(error as Error);
    }
  });
  child.stderr?.on('data', chunk => {
    try {
      stderr = appendLimited(stderr, Buffer.from(chunk), FFMPEG_MAX_STDERR_BYTES);
    } catch {
      child.kill('SIGKILL');
    }
  });
  child.once('error', error => {
    const systemCode = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
    finish(new MediaProcessError('spawn', 'Não foi possível iniciar FFprobe.', systemCode));
  });
  child.once('close', code => {
    if (settled) return;
    if (timedOut) {
      finish(new MediaProcessError('timeout', 'FFprobe excedeu o tempo limite.'));
      return;
    }
    if (code !== 0) {
      finish(new MediaProcessError('failed', stderr.trim() || `FFprobe encerrou com código ${code}.`));
      return;
    }
    if (!stdout.trim()) {
      finish(new MediaProcessError('invalid-output', 'FFprobe não retornou JSON.'));
      return;
    }
    finish();
  });
});

export const runImportMediaTransform: ImportMediaTransformRunner = options => new Promise((resolve, reject) => {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-protocol_whitelist', SAFE_PROTOCOLS,
    '-format_whitelist', SAFE_DEMUXERS,
    '-i', '/proc/self/fd/3',
    '-map', `0:${options.streamIndex}`,
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata', '-1',
    '-map_chapters', '-1'
  ];

  if (options.mode === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    if (!options.bitRate) {
      reject(new MediaProcessError('failed', 'Bitrate de conversão ausente.'));
      return;
    }
    args.push(
      '-c:a', 'aac',
      '-profile:a', 'aac_low',
      '-b:a', `${Math.round(options.bitRate / 1000)}k`,
      '-threads', '1'
    );
    if ((options.channels ?? 0) > 2) args.push('-ac', '2');
    if ((options.sampleRate ?? 0) > 48_000) args.push('-ar', '48000');
  }

  if (options.muxer === 'mp4') args.push('-movflags', '+faststart');
  args.push('-f', options.muxer, options.outputPath);

  const child = spawn(options.command, args, {
    stdio: ['ignore', 'ignore', 'pipe', options.inputFd],
    windowsHide: true
  });
  let stderr = '';
  let settled = false;
  let timedOut = false;

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve();
  };

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs);
  timer.unref?.();

  child.stderr?.on('data', chunk => {
    stderr = `${stderr}${Buffer.from(chunk).toString('utf8')}`.slice(-FFMPEG_MAX_STDERR_BYTES);
  });
  child.once('error', error => {
    const systemCode = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
    finish(new MediaProcessError('spawn', 'Não foi possível iniciar FFmpeg.', systemCode));
  });
  child.once('close', code => {
    if (timedOut) {
      finish(new MediaProcessError('timeout', 'FFmpeg excedeu o tempo limite.'));
      return;
    }
    if (code !== 0) {
      finish(new MediaProcessError('failed', stderr.trim() || `FFmpeg encerrou com código ${code}.`));
      return;
    }
    finish();
  });
});

function primaryContainer(probe: MediaProbeResult) {
  const names = new Set(probe.formatNames);
  if (names.has('mp3')) return 'mp3';
  if (names.has('flac')) return 'flac';
  if (names.has('wav')) return 'wav';
  if (names.has('aac')) return 'aac';
  if (names.has('ogg')) return 'ogg';
  if (names.has('mov') || names.has('mp4') || names.has('m4a')) return 'mp4';
  if (names.has('webm')) return 'webm';
  if (names.has('matroska')) return 'matroska';
  return probe.formatNames[0] ?? 'unknown';
}

function preserveExtension(probe: MediaProbeResult) {
  const codec = probe.selectedAudioStream.codec;
  const container = primaryContainer(probe);
  if (container === 'mp3' && codec === 'mp3') return '.mp3';
  if (container === 'flac' && codec === 'flac') return '.flac';
  if (container === 'wav' && codec.startsWith('pcm_')) return '.wav';
  if (container === 'aac' && codec === 'aac') return '.aac';
  if (container === 'ogg' && codec === 'vorbis') return '.ogg';
  if (container === 'ogg' && codec === 'opus') return '.opus';
  if (container === 'mp4' && (codec === 'aac' || codec === 'alac' || codec === 'mp3')) return '.m4a';
  return null;
}

function remuxTargetForCodec(codec: string): RemuxTarget | null {
  if (codec === 'mp3') return { container: 'mp3', extension: '.mp3', muxer: 'mp3' };
  if (codec === 'flac') return { container: 'flac', extension: '.flac', muxer: 'flac' };
  if (codec.startsWith('pcm_')) return { container: 'wav', extension: '.wav', muxer: 'wav' };
  if (codec === 'aac' || codec === 'alac') return { container: 'mp4', extension: '.m4a', muxer: 'mp4' };
  if (codec === 'vorbis') return { container: 'ogg', extension: '.ogg', muxer: 'ogg' };
  if (codec === 'opus') return { container: 'ogg', extension: '.opus', muxer: 'ogg' };
  return null;
}

function isSingleAudioOnly(probe: MediaProbeResult) {
  return probe.audioStreams.length === 1 && probe.videoStreams === 0;
}

function compatibilityAudioCanBeCopied(probe: MediaProbeResult) {
  return probe.selectedAudioStream.codec === 'aac'
    && (probe.selectedAudioStream.channels ?? 2) <= 2
    && (probe.selectedAudioStream.sampleRate ?? 48_000) <= 48_000;
}

function isCompatibilityReady(probe: MediaProbeResult) {
  return isSingleAudioOnly(probe)
    && primaryContainer(probe) === 'mp4'
    && compatibilityAudioCanBeCopied(probe);
}

function technicalInfo(probe: MediaProbeResult): ImportMediaTechnicalInfo {
  const stream = probe.selectedAudioStream;
  return {
    container: primaryContainer(probe),
    codec: stream.codec,
    durationSeconds: probe.durationSeconds,
    bitRate: stream.bitRate ?? probe.bitRate,
    sampleRate: stream.sampleRate,
    channels: stream.channels,
    audioStreams: probe.audioStreams.length,
    videoStreams: probe.videoStreams
  };
}

function transformReason(profile: ImportOutputProfile, probe: MediaProbeResult): ImportMediaDecisionReason {
  if (probe.videoStreams > 0) return 'contains-video';
  if (probe.audioStreams.length > 1) return 'multiple-audio-streams';
  if (profile === 'economy') return 'economy-requested';
  if (profile === 'compatibility') return 'compatibility-requested';
  return 'unsupported-original';
}

function transcodeOutput(profile: ImportOutputProfile) {
  return {
    container: 'mp4',
    codec: 'aac',
    extension: '.m4a',
    bitRate: profile === 'economy' ? ECONOMY_BITRATE : COMPATIBILITY_BITRATE
  } as const;
}

export function decideImportMedia(profile: ImportOutputProfile, probe: MediaProbeResult): ImportMediaDecision {
  const extension = preserveExtension(probe);
  const remuxTarget = remuxTargetForCodec(probe.selectedAudioStream.codec);
  const sourceBitRate = probe.selectedAudioStream.bitRate ?? probe.bitRate;
  const singleAudioOnly = isSingleAudioOnly(probe);
  const reason = transformReason(profile, probe);

  if (profile === 'original') {
    if (extension && singleAudioOnly) {
      return {
        profile,
        action: 'preserve',
        reason: 'original-compatible',
        selectedAudioStream: probe.selectedAudioStream.index,
        input: technicalInfo(probe),
        output: {
          container: primaryContainer(probe),
          codec: probe.selectedAudioStream.codec,
          extension,
          bitRate: sourceBitRate
        }
      };
    }
    if (remuxTarget) {
      return {
        profile,
        action: 'remux',
        reason,
        selectedAudioStream: probe.selectedAudioStream.index,
        input: technicalInfo(probe),
        output: {
          container: remuxTarget.container,
          codec: probe.selectedAudioStream.codec,
          extension: remuxTarget.extension,
          bitRate: sourceBitRate
        }
      };
    }
  } else if (profile === 'economy') {
    const alreadyEconomical = sourceBitRate != null && sourceBitRate <= ECONOMY_PRESERVE_THRESHOLD;
    if (alreadyEconomical && extension && singleAudioOnly) {
      return {
        profile,
        action: 'preserve',
        reason: 'already-economical',
        selectedAudioStream: probe.selectedAudioStream.index,
        input: technicalInfo(probe),
        output: {
          container: primaryContainer(probe),
          codec: probe.selectedAudioStream.codec,
          extension,
          bitRate: sourceBitRate
        }
      };
    }
    if (alreadyEconomical && remuxTarget) {
      return {
        profile,
        action: 'remux',
        reason,
        selectedAudioStream: probe.selectedAudioStream.index,
        input: technicalInfo(probe),
        output: {
          container: remuxTarget.container,
          codec: probe.selectedAudioStream.codec,
          extension: remuxTarget.extension,
          bitRate: sourceBitRate
        }
      };
    }
  } else {
    if (isCompatibilityReady(probe)) {
      return {
        profile,
        action: 'preserve',
        reason: 'already-compatible',
        selectedAudioStream: probe.selectedAudioStream.index,
        input: technicalInfo(probe),
        output: {
          container: 'mp4',
          codec: 'aac',
          extension: '.m4a',
          bitRate: sourceBitRate
        }
      };
    }
    if (compatibilityAudioCanBeCopied(probe)) {
      return {
        profile,
        action: 'remux',
        reason,
        selectedAudioStream: probe.selectedAudioStream.index,
        input: technicalInfo(probe),
        output: {
          container: 'mp4',
          codec: 'aac',
          extension: '.m4a',
          bitRate: sourceBitRate
        }
      };
    }
  }

  return {
    profile,
    action: 'transcode',
    reason,
    selectedAudioStream: probe.selectedAudioStream.index,
    input: technicalInfo(probe),
    output: transcodeOutput(profile)
  };
}

function parseProfile(raw: unknown): ImportOutputProfile {
  if (raw == null || raw === '') return 'original';
  if (raw === 'original' || raw === 'economy' || raw === 'compatibility') return raw;
  throw new ImportMediaValidationError('invalid_profile', 'Perfil de saída inválido.');
}

function durationMatches(initial: MediaProbeResult, final: MediaProbeResult) {
  const toleranceSeconds = Math.max(2, initial.durationSeconds * 0.02);
  return Math.abs(final.durationSeconds - initial.durationSeconds) <= toleranceSeconds;
}

function ensureFinalMatchesDecision(
  initial: MediaProbeResult,
  final: MediaProbeResult,
  decision: ImportMediaDecision
) {
  if (decision.action === 'transcode') {
    if (!isCompatibilityReady(final)) {
      throw new ImportMediaValidationError('invalid_media', 'A conversão não produziu um M4A/AAC compatível.', 422);
    }
    if (!durationMatches(initial, final)) {
      throw new ImportMediaValidationError('invalid_media', 'A duração mudou além do esperado durante a conversão.', 422);
    }
    return;
  }

  if (decision.action === 'remux') {
    if (
      !isSingleAudioOnly(final)
      || final.selectedAudioStream.codec !== initial.selectedAudioStream.codec
      || primaryContainer(final) !== decision.output.container
    ) {
      throw new ImportMediaValidationError('invalid_media', 'O remux não preservou a faixa de áudio esperada.', 422);
    }
    if (!durationMatches(initial, final)) {
      throw new ImportMediaValidationError('invalid_media', 'A duração mudou além do esperado durante o remux.', 422);
    }
    return;
  }

  if (final.selectedAudioStream.codec !== initial.selectedAudioStream.codec || primaryContainer(final) !== primaryContainer(initial)) {
    throw new ImportMediaValidationError('invalid_media', 'O payload mudou durante a validação técnica.', 422);
  }
}

function finalizedDecision(
  planned: ImportMediaDecision,
  finalProbe: MediaProbeResult
): ImportMediaDecision {
  return {
    ...planned,
    output: {
      ...planned.output,
      container: primaryContainer(finalProbe),
      codec: finalProbe.selectedAudioStream.codec,
      bitRate: finalProbe.selectedAudioStream.bitRate ?? finalProbe.bitRate ?? planned.output.bitRate
    }
  };
}

function canonicalProbeError(error: unknown) {
  if (error instanceof ImportMediaValidationError) return error;
  if (error instanceof MediaProcessError) {
    if (error.reason === 'spawn' && error.systemCode === 'ENOENT') {
      return new ImportMediaValidationError('probe_unavailable', 'FFprobe não está disponível para validar a importação.', 503);
    }
    if (error.reason === 'timeout') {
      return new ImportMediaValidationError('probe_timeout', 'FFprobe excedeu o tempo limite de validação.', 504);
    }
    return new ImportMediaValidationError('invalid_media', 'FFprobe rejeitou ou não reconheceu a mídia importada.', 422);
  }
  return new ImportMediaValidationError('invalid_media', 'Não foi possível validar tecnicamente a mídia importada.', 422);
}

function canonicalTransformError(error: unknown) {
  if (error instanceof ImportMediaValidationError) return error;
  if (error instanceof MediaProcessError) {
    if (error.reason === 'spawn' && error.systemCode === 'ENOENT') {
      return new ImportMediaValidationError('transcode_unavailable', 'FFmpeg não está disponível para processar a importação.', 503);
    }
    if (error.reason === 'timeout') {
      return new ImportMediaValidationError('transcode_timeout', 'FFmpeg excedeu o tempo limite de processamento.', 504);
    }
  }
  return new ImportMediaValidationError('transcode_failed', 'FFmpeg não conseguiu processar a mídia importada.', 422);
}

function transformMode(decision: ImportMediaDecision) {
  return decision.action === 'remux' ? 'copy' as const : 'aac' as const;
}

function transformMuxer(decision: ImportMediaDecision): ImportMediaMuxer {
  if (decision.action === 'transcode') return 'mp4';
  const target = remuxTargetForCodec(decision.output.codec);
  if (!target || target.container !== decision.output.container) {
    throw new ImportMediaValidationError('invalid_media', 'Não há container seguro para preservar este codec.', 422);
  }
  return target.muxer;
}

export class ImportMediaValidationManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly ffmpegCommand: string;
  private readonly ffprobeCommand: string;
  private readonly timeoutMs: number;
  private readonly probeRunner: MediaProbeRunner;
  private readonly transformRunner: ImportMediaTransformRunner;
  private readonly validated = new Map<string, ValidatedImportPayload<MediaProbeResult>>();

  constructor(options: ImportMediaValidationManagerOptions) {
    this.queue = options.queue;
    this.staging = options.staging;
    this.ffmpegCommand = cleanCommand(options.ffmpegCommand, 'ffmpeg', 'FFmpeg');
    this.ffprobeCommand = cleanCommand(options.ffprobeCommand, DEFAULT_FFPROBE_COMMAND, 'FFprobe');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_IMPORT_MEDIA_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Timeout de validação de mídia inválido.');
    }
    this.probeRunner = options.probeRunner ?? runFfprobe;
    this.transformRunner = options.transformRunner ?? runImportMediaTransform;
  }

  get profiles() {
    return IMPORT_OUTPUT_PROFILES.map(profile => ({ ...profile }));
  }

  getValidated(jobId: string) {
    return this.validated.get(jobId) ?? null;
  }

  async validate(jobId: string, rawProfile?: unknown) {
    const profile = parseProfile(rawProfile);
    const job = this.queue.get(jobId);
    if (!job) throw new ImportMediaValidationError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportMediaValidationError('job_not_ready', 'O job precisa estar pendente para validar a mídia.', 409);
    }
    const existing = this.validated.get(jobId);
    if (existing) {
      if (job.mediaDecision?.profile === profile) {
        return { job, validation: job.mediaDecision };
      }
      throw new ImportMediaValidationError('already_validated', 'A mídia deste job já foi validada com outro perfil.', 409);
    }
    if (job.mediaDecision) {
      throw new ImportMediaValidationError('already_validated', 'Este job já possui uma decisão técnica de mídia.', 409);
    }

    this.queue.transition(jobId, 'processing');
    let plannedDecision: ImportMediaDecision | null = null;
    let initialProbe: MediaProbeResult | null = null;

    try {
      try {
        initialProbe = await this.staging.inspectPayload(jobId, async target => {
          const raw = await this.probeRunner(this.ffprobeCommand, target, PROBE_TIMEOUT_MS);
          return parseMediaProbeJson(raw);
        });
      } catch (error) {
        throw canonicalProbeError(error);
      }

      plannedDecision = decideImportMedia(profile, initialProbe);
      this.queue.setMediaDecision(jobId, plannedDecision);

      if (plannedDecision.action !== 'preserve') {
        try {
          await this.staging.transformPayload(jobId, target => this.transformRunner({
            command: this.ffmpegCommand,
            inputFd: target.input.fd,
            outputPath: target.outputPath,
            streamIndex: plannedDecision!.selectedAudioStream,
            mode: transformMode(plannedDecision!),
            muxer: transformMuxer(plannedDecision!),
            bitRate: plannedDecision!.action === 'transcode' ? plannedDecision!.output.bitRate : null,
            channels: initialProbe!.selectedAudioStream.channels,
            sampleRate: initialProbe!.selectedAudioStream.sampleRate,
            timeoutMs: this.timeoutMs
          }));
        } catch (error) {
          throw canonicalTransformError(error);
        }
      }

      let validated: ValidatedImportPayload<MediaProbeResult>;
      try {
        validated = await this.staging.validatePayload(jobId, async target => {
          const raw = await this.probeRunner(this.ffprobeCommand, target, PROBE_TIMEOUT_MS);
          return parseMediaProbeJson(raw);
        });
      } catch (error) {
        throw canonicalProbeError(error);
      }

      ensureFinalMatchesDecision(initialProbe, validated.validation, plannedDecision);
      const decision = finalizedDecision(plannedDecision, validated.validation);
      this.queue.setMediaDecision(jobId, decision);
      this.validated.set(jobId, validated);
      const ready = this.queue.transition(jobId, 'pending')!;
      return { job: ready, validation: decision };
    } catch (error) {
      const failure = error instanceof ImportMediaValidationError
        ? error
        : new ImportMediaValidationError('invalid_media', 'Falha na validação técnica da mídia.', 422);
      await this.staging.cleanupJob(jobId).catch(() => undefined);
      const current = this.queue.get(jobId);
      if (current?.status === 'processing' || current?.status === 'pending') {
        this.queue.transition(jobId, 'failed', failure.message);
      }
      throw failure;
    }
  }
}
