import { spawn } from 'node:child_process';
import {
  DJ_KEY_ANALYSIS_VERSION,
  djKeyFromPitchClass,
  type DjKeyMode,
  type TrackMusicalKey
} from '@home-music/shared';
import type { IndexedTrack } from './library.js';
import { isFfmpegDecodeFailure } from './rhythm-analysis.js';
import { resolveRegularFileInside } from './security.js';

export const KEY_ANALYZER_VERSION = DJ_KEY_ANALYSIS_VERSION;
export const KEY_ANALYSIS_SAMPLE_RATE = 11_025;
export const KEY_ANALYSIS_SECONDS = 90;
export const KEY_ANALYSIS_TIMEOUT_MS = 60_000;

const MAX_FFMPEG_STDERR_BYTES = 16 * 1024;
const MAX_PCM_BYTES = KEY_ANALYSIS_SAMPLE_RATE * KEY_ANALYSIS_SECONDS * 2 + 64 * 1024;
const FRAME_SIZE = 4_096;
const FRAME_STEP = 2_048;
const MIN_ANALYSIS_SECONDS = 4;
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export class KeyAnalysisUnavailableError extends Error {
  readonly reason = 'ffmpeg-decode-failed';

  constructor(readonly exitCode: number | null) {
    super(`FFmpeg não conseguiu decodificar a faixa para análise tonal (código ${exitCode ?? 'desconhecido'}).`);
    this.name = 'KeyAnalysisUnavailableError';
  }
}

export type KeyAnalysisRunner = (
  command: string,
  filePath: string,
  signal?: AbortSignal
) => Promise<Int16Array>;

function goertzelPower(samples: Int16Array, start: number, length: number, frequency: number, sampleRate: number) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;

  for (let index = 0; index < length; index += 1) {
    const position = start + index;
    const window = 0.5 - (0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, length - 1)));
    const sample = (samples[position] ?? 0) / 32_768;
    s0 = (sample * window) + (coefficient * s1) - s2;
    s2 = s1;
    s1 = s0;
  }

  return Math.max(0, (s1 * s1) + (s2 * s2) - (coefficient * s1 * s2));
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function rotatedProfile(profile: number[], tonic: number) {
  return Array.from({ length: 12 }, (_, pitchClass) => (
    profile[(pitchClass - tonic + 12) % 12] ?? 0
  ));
}

function addKeyFrame(
  samples: Int16Array,
  start: number,
  sampleRate: number,
  chroma: number[]
) {
  let frameEnergy = 0;
  for (let index = 0; index < FRAME_SIZE; index += 1) {
    const sample = (samples[start + index] ?? 0) / 32_768;
    frameEnergy += sample * sample;
  }
  if (frameEnergy / FRAME_SIZE < 1e-7) return 0;

  for (let midi = 36; midi <= 95; midi += 1) {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    const pitchClass = midi % 12;
    chroma[pitchClass] += Math.sqrt(
      goertzelPower(samples, start, FRAME_SIZE, frequency, sampleRate)
    );
  }
  return frameEnergy;
}

function keyFromChroma(chroma: number[], frames: number, totalEnergy: number) {
  if (frames === 0 || totalEnergy <= 1e-4) return null;

  const maxChroma = Math.max(...chroma);
  if (!Number.isFinite(maxChroma) || maxChroma <= 0) return null;
  const normalized = chroma.map(value => value / maxChroma);

  const candidates: Array<{ tonic: number; mode: DjKeyMode; score: number }> = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    candidates.push({
      tonic,
      mode: 'major',
      score: cosineSimilarity(normalized, rotatedProfile(MAJOR_PROFILE, tonic))
    });
    candidates.push({
      tonic,
      mode: 'minor',
      score: cosineSimilarity(normalized, rotatedProfile(MINOR_PROFILE, tonic))
    });
  }
  candidates.sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const second = candidates[1];
  if (!best || !second || best.score < 0.45) return null;

  const margin = Math.max(0, best.score - second.score);
  const confidence = Math.max(0, Math.min(1, (margin * 5) + ((best.score - 0.45) * 0.45)));
  return djKeyFromPitchClass(best.tonic, best.mode, confidence);
}

export function analyzePcmKey(
  samples: Int16Array,
  sampleRate = KEY_ANALYSIS_SAMPLE_RATE
): TrackMusicalKey | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (samples.length < sampleRate * MIN_ANALYSIS_SECONDS) return null;

  const chroma = new Array<number>(12).fill(0);
  let frames = 0;
  let totalEnergy = 0;

  for (let start = 0; start + FRAME_SIZE <= samples.length; start += FRAME_STEP) {
    const energy = addKeyFrame(samples, start, sampleRate, chroma);
    if (energy <= 0) continue;
    frames += 1;
    totalEnergy += energy;
  }

  return keyFromChroma(chroma, frames, totalEnergy);
}

export async function analyzePcmKeyAsync(
  samples: Int16Array,
  sampleRate = KEY_ANALYSIS_SAMPLE_RATE,
  signal?: AbortSignal
): Promise<TrackMusicalKey | null> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (samples.length < sampleRate * MIN_ANALYSIS_SECONDS) return null;

  const chroma = new Array<number>(12).fill(0);
  let frames = 0;
  let totalEnergy = 0;
  let processedFrames = 0;

  for (let start = 0; start + FRAME_SIZE <= samples.length; start += FRAME_STEP) {
    if (signal?.aborted) throw new Error('Análise tonal cancelada.');
    const energy = addKeyFrame(samples, start, sampleRate, chroma);
    if (energy > 0) {
      frames += 1;
      totalEnergy += energy;
    }
    processedFrames += 1;
    if (processedFrames % 6 === 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  return keyFromChroma(chroma, frames, totalEnergy);
}

export const decodeTrackToKeyPcm: KeyAnalysisRunner = (
  command,
  filePath,
  signal
) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('Análise tonal cancelada.'));
    return;
  }

  const child = spawn(command, [
    '-v', 'error',
    '-nostdin',
    '-i', filePath,
    '-vn',
    '-ac', '1',
    '-ar', String(KEY_ANALYSIS_SAMPLE_RATE),
    '-t', String(KEY_ANALYSIS_SECONDS),
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

  const onAbort = () => failAndKill('Análise tonal cancelada.');
  signal?.addEventListener('abort', onAbort, { once: true });

  timeout = setTimeout(() => {
    failAndKill('FFmpeg excedeu o timeout da análise tonal.');
  }, KEY_ANALYSIS_TIMEOUT_MS);
  timeout.unref();

  child.stdout.on('data', (chunk: Buffer) => {
    if (settled) return;
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > MAX_PCM_BYTES) {
      failAndKill('FFmpeg excedeu o limite de PCM da análise tonal.');
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
      if (isFfmpegDecodeFailure(details)) finish(new KeyAnalysisUnavailableError(code));
      else finish(new Error(`FFmpeg encerrou a análise tonal com código ${code ?? 'desconhecido'}.`));
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

export async function analyzeTrackKey(
  libraryRoot: string,
  track: IndexedTrack,
  ffmpegCommand: string,
  signal?: AbortSignal,
  runner: KeyAnalysisRunner = decodeTrackToKeyPcm
): Promise<TrackMusicalKey | null> {
  const before = await resolveRegularFileInside(libraryRoot, track.filePath);
  if (!signatureMatches(track, before.stat)) return null;

  const samples = await runner(ffmpegCommand, before.path, signal);
  const key = await analyzePcmKeyAsync(samples, KEY_ANALYSIS_SAMPLE_RATE, signal);
  if (!key) return null;

  const after = await resolveRegularFileInside(libraryRoot, track.filePath);
  if (!signatureMatches(track, after.stat)) return null;
  return key;
}
