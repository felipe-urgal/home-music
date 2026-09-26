import { spawn } from 'node:child_process';
import type { TrackWaveform } from '@home-music/shared';
import type { IndexedTrack } from './library.js';
import { isFfmpegDecodeFailure } from './rhythm-analysis.js';
import { resolveRegularFileInside } from './security.js';

export const WAVEFORM_ANALYZER_VERSION = 1;
export const WAVEFORM_SAMPLE_RATE = 1_000;
export const WAVEFORM_POINT_COUNT = 1_024;
export const WAVEFORM_TIMEOUT_MS = 60_000;

const MAX_FFMPEG_STDERR_BYTES = 16 * 1024;
const MAX_PCM_BYTES = 64 * 1024 * 1024;

export class WaveformAnalysisUnavailableError extends Error {
  readonly reason = 'ffmpeg-decode-failed';

  constructor(readonly exitCode: number | null) {
    super(`FFmpeg não conseguiu decodificar a faixa para waveform (código ${exitCode ?? 'desconhecido'}).`);
    this.name = 'WaveformAnalysisUnavailableError';
  }
}

export type WaveformAnalysisRunner = (
  command: string,
  filePath: string,
  signal?: AbortSignal
) => Promise<Int16Array>;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function analyzePcmWaveform(
  samples: Int16Array,
  sampleRate = WAVEFORM_SAMPLE_RATE,
  pointCount = WAVEFORM_POINT_COUNT
): TrackWaveform | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (!Number.isInteger(pointCount) || pointCount <= 0) return null;
  if (!samples.length) return null;

  const actualPoints = Math.min(pointCount, samples.length);
  const peaks = new Array<number>(actualPoints).fill(0);
  let globalPeak = 0;

  for (let point = 0; point < actualPoints; point += 1) {
    const start = Math.floor((point * samples.length) / actualPoints);
    const end = Math.max(start + 1, Math.floor(((point + 1) * samples.length) / actualPoints));
    let peak = 0;
    for (let index = start; index < end && index < samples.length; index += 1) {
      peak = Math.max(peak, Math.abs(samples[index] / 32_768));
    }
    peaks[point] = peak;
    globalPeak = Math.max(globalPeak, peak);
  }

  const normalized = globalPeak > 0
    ? peaks.map(value => Number(clamp01(value / globalPeak).toFixed(4)))
    : peaks;

  return {
    version: WAVEFORM_ANALYZER_VERSION,
    durationSeconds: Number((samples.length / sampleRate).toFixed(4)),
    peaks: normalized
  };
}

export const decodeTrackToWaveformPcm: WaveformAnalysisRunner = (
  command,
  filePath,
  signal
) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('Análise de waveform cancelada.'));
    return;
  }

  const child = spawn(command, [
    '-v', 'error',
    '-nostdin',
    '-i', filePath,
    '-vn',
    '-ac', '1',
    '-ar', String(WAVEFORM_SAMPLE_RATE),
    '-f', 's16le',
    'pipe:1'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let settled = false;
  let timeout: NodeJS.Timeout | null = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];

  const finish = (error?: Error, samples?: Int16Array) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    if (error) reject(error);
    else resolve(samples ?? new Int16Array());
  };

  const failAndKill = (message: string) => {
    child.kill();
    finish(new Error(message));
  };

  const onAbort = () => failAndKill('Análise de waveform cancelada.');
  signal?.addEventListener('abort', onAbort, { once: true });

  timeout = setTimeout(() => {
    failAndKill('FFmpeg excedeu o timeout da análise de waveform.');
  }, WAVEFORM_TIMEOUT_MS);
  timeout.unref();

  child.stdout.on('data', (chunk: Buffer) => {
    if (settled) return;
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > MAX_PCM_BYTES) {
      failAndKill('FFmpeg excedeu o limite de PCM da análise de waveform.');
      return;
    }
    stdout.push(Buffer.from(chunk));
  });

  child.stderr.on('data', (chunk: Buffer) => {
    if (settled || stderrBytes >= MAX_FFMPEG_STDERR_BYTES) return;
    const remaining = MAX_FFMPEG_STDERR_BYTES - stderrBytes;
    const accepted = chunk.subarray(0, remaining);
    stderr.push(Buffer.from(accepted));
    stderrBytes += accepted.byteLength;
  });

  child.once('error', error => finish(error));
  child.once('close', code => {
    if (settled) return;
    if (code !== 0) {
      const details = Buffer.concat(stderr).toString('utf8');
      if (isFfmpegDecodeFailure(details)) {
        finish(new WaveformAnalysisUnavailableError(code));
      } else {
        finish(new Error(`FFmpeg encerrou a análise de waveform com código ${code ?? 'desconhecido'}.`));
      }
      return;
    }

    const pcm = Buffer.concat(stdout);
    const sampleCount = Math.floor(pcm.byteLength / 2);
    const samples = new Int16Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = pcm.readInt16LE(index * 2);
    }
    finish(undefined, samples);
  });
});

function signatureMatches(track: IndexedTrack, stat: { size: number; mtimeMs: number }) {
  return track.fileSize === stat.size && track.mtimeMs === stat.mtimeMs;
}

export async function analyzeTrackWaveform(
  libraryRoot: string,
  track: IndexedTrack,
  ffmpegCommand: string,
  signal?: AbortSignal,
  runner: WaveformAnalysisRunner = decodeTrackToWaveformPcm
): Promise<TrackWaveform | null> {
  const before = await resolveRegularFileInside(libraryRoot, track.filePath);
  if (!signatureMatches(track, before.stat)) return null;

  const samples = await runner(ffmpegCommand, before.path, signal);
  const waveform = analyzePcmWaveform(samples);
  if (!waveform) return null;

  const after = await resolveRegularFileInside(libraryRoot, track.filePath);
  if (!signatureMatches(track, after.stat)) return null;
  return waveform;
}
