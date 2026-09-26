import { spawn } from 'node:child_process';
import { MIN_DOWNBEAT_CONFIDENCE, type TrackRhythm } from '@home-music/shared';
import type { IndexedTrack } from './library.js';
import { resolveRegularFileInside } from './security.js';

export const RHYTHM_ANALYZER_VERSION = 2;
export const RHYTHM_ANALYSIS_SAMPLE_RATE = 8_000;
export const RHYTHM_ANALYSIS_SECONDS = 90;
export const RHYTHM_ANALYSIS_TIMEOUT_MS = 20_000;

const MIN_ANALYSIS_SECONDS = 4;
const MIN_BPM = 55;
const MAX_BPM = 200;
const MIN_CORRELATION = 0.08;
const MIN_DOWNBEAT_BARS = 4;
const MIN_DOWNBEAT_ACCENT_CONTRAST = 0.18;
const MIN_DOWNBEAT_CONSISTENCY = 0.75;
const MIN_DOWNBEAT_CANDIDATE_MARGIN = 0.08;
const MAX_FFMPEG_STDERR_BYTES = 16 * 1024;
const MAX_PCM_BYTES = RHYTHM_ANALYSIS_SAMPLE_RATE * RHYTHM_ANALYSIS_SECONDS * 2 + 64 * 1024;

export class RhythmAnalysisUnavailableError extends Error {
  readonly reason = 'ffmpeg-decode-failed';

  constructor(readonly exitCode: number | null) {
    super(`FFmpeg não conseguiu decodificar a faixa para análise rítmica (código ${exitCode ?? 'desconhecido'}).`);
    this.name = 'RhythmAnalysisUnavailableError';
  }
}

export function isFfmpegDecodeFailure(stderr: string) {
  return (
    /invalid data found when processing input/i.test(stderr)
    || /error submitting packet to decoder/i.test(stderr)
    || /error while decoding stream/i.test(stderr)
    || /corrupt(?:ed)? (?:input )?packet/i.test(stderr)
  );
}

export type RhythmAnalysisRunner = (
  command: string,
  filePath: string,
  signal?: AbortSignal
) => Promise<Int16Array>;

function percentile(values: Float64Array, ratio: number) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

function correlationAt(values: Float64Array, lag: number) {
  let product = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = lag; index < values.length; index += 1) {
    const left = values[index];
    const right = values[index - lag];
    product += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0 ? product / denominator : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

type DownbeatCandidate = {
  beatsPerBar: 3 | 4;
  phase: number;
  contrast: number;
  consistency: number;
  score: number;
};

function estimateDownbeat(
  onset: Float64Array,
  firstBeatFrame: number,
  beatLagFrames: number,
  hopSeconds: number,
  firstBeatSeconds: number
): Pick<TrackRhythm, 'downbeatSeconds' | 'beatsPerBar' | 'downbeatConfidence'> | null {
  if (!Number.isFinite(beatLagFrames) || beatLagFrames <= 0) return null;

  const strengths: number[] = [];
  for (let beatIndex = 0; ; beatIndex += 1) {
    const center = Math.round(firstBeatFrame + (beatIndex * beatLagFrames));
    if (center >= onset.length) break;

    let peak = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const index = center + offset;
      if (index >= 0 && index < onset.length) peak = Math.max(peak, onset[index] ?? 0);
    }
    strengths.push(peak);
  }

  const candidates: DownbeatCandidate[] = [];
  for (const beatsPerBar of [3, 4] as const) {
    if (strengths.length < beatsPerBar * MIN_DOWNBEAT_BARS) continue;

    for (let phase = 0; phase < beatsPerBar; phase += 1) {
      const accented = strengths.filter((_, index) => index % beatsPerBar === phase);
      const others = strengths.filter((_, index) => index % beatsPerBar !== phase);
      if (!accented.length || !others.length) continue;

      const accentedMean = accented.reduce((sum, value) => sum + value, 0) / accented.length;
      const otherMean = others.reduce((sum, value) => sum + value, 0) / others.length;
      if (accentedMean <= otherMean || accentedMean <= 0) continue;

      const contrast = (accentedMean - otherMean) / accentedMean;
      const consistency = accented.filter(value => value > otherMean).length / accented.length;
      const score = contrast * (0.7 + (consistency * 0.3));
      candidates.push({ beatsPerBar, phase, contrast, consistency, score });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) return null;

  const runnerUp = candidates[1];
  const margin = best.score - (runnerUp?.score ?? 0);
  if (
    best.contrast < MIN_DOWNBEAT_ACCENT_CONTRAST
    || best.consistency < MIN_DOWNBEAT_CONSISTENCY
    || margin < MIN_DOWNBEAT_CANDIDATE_MARGIN
  ) return null;

  const confidence = clamp(
    (clamp(best.contrast / 0.5, 0, 1) * 0.55)
      + (best.consistency * 0.25)
      + (clamp(margin / 0.25, 0, 1) * 0.2),
    0,
    1
  );
  if (confidence < MIN_DOWNBEAT_CONFIDENCE) return null;

  const downbeatSeconds = firstBeatSeconds + (best.phase * beatLagFrames * hopSeconds);
  return {
    downbeatSeconds: Number(downbeatSeconds.toFixed(4)),
    beatsPerBar: best.beatsPerBar,
    downbeatConfidence: Number(confidence.toFixed(4))
  };
}

export function analyzePcmRhythm(
  samples: Int16Array,
  sampleRate = RHYTHM_ANALYSIS_SAMPLE_RATE
): TrackRhythm | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (samples.length < sampleRate * MIN_ANALYSIS_SECONDS) return null;

  const hopSize = Math.max(32, Math.round(sampleRate * 0.01));
  const frameSize = hopSize * 3;
  const frameCount = Math.floor((samples.length - frameSize) / hopSize) + 1;
  if (frameCount < 16) return null;

  const energy = new Float64Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    let squared = 0;
    for (let offset = 0; offset < frameSize; offset += 1) {
      const normalized = samples[start + offset] / 32_768;
      squared += normalized * normalized;
    }
    energy[frame] = Math.sqrt(squared / frameSize);
  }

  const onset = new Float64Array(frameCount);
  let maxOnset = 0;
  for (let index = 1; index < frameCount; index += 1) {
    const value = Math.max(0, energy[index] - energy[index - 1]);
    onset[index] = value;
    maxOnset = Math.max(maxOnset, value);
  }
  if (maxOnset < 1e-5) return null;

  const onsetThreshold = Math.max(percentile(onset, 0.75) * 1.25, maxOnset * 0.05);
  const envelope = new Float64Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    if (onset[index] >= onsetThreshold) envelope[index] = onset[index];
  }

  const hopSeconds = hopSize / sampleRate;
  const minimumLag = Math.max(1, Math.round(60 / MAX_BPM / hopSeconds));
  const maximumLag = Math.min(
    Math.floor(envelope.length / 2),
    Math.round(60 / MIN_BPM / hopSeconds)
  );
  if (maximumLag <= minimumLag) return null;

  const correlations = new Map<number, number>();
  let strongestCorrelation = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    const correlation = correlationAt(envelope, lag);
    correlations.set(lag, correlation);
    strongestCorrelation = Math.max(strongestCorrelation, correlation);
  }
  if (strongestCorrelation < MIN_CORRELATION) return null;

  const acceptableCorrelation = strongestCorrelation * 0.9;
  let selectedLag = 0;
  let selectedCorrelation = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    const correlation = correlations.get(lag) ?? 0;
    if (correlation >= acceptableCorrelation && correlation >= MIN_CORRELATION) {
      selectedLag = lag;
      selectedCorrelation = correlation;
      break;
    }
  }
  if (!selectedLag) return null;

  let refinedLag = selectedLag;
  const previous = correlations.get(selectedLag - 1);
  const current = correlations.get(selectedLag);
  const next = correlations.get(selectedLag + 1);
  if (previous != null && current != null && next != null) {
    const denominator = previous - (2 * current) + next;
    if (Math.abs(denominator) > 1e-9) {
      const offset = 0.5 * (previous - next) / denominator;
      if (Math.abs(offset) <= 1) refinedLag += offset;
    }
  }

  const bpm = 60 / (refinedLag * hopSeconds);
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return null;

  const strongOnsetThreshold = Math.max(percentile(onset, 0.9), maxOnset * 0.25);
  let firstBeatFrame = -1;
  for (let index = 1; index < onset.length - 1; index += 1) {
    if (
      onset[index] >= strongOnsetThreshold
      && onset[index] >= onset[index - 1]
      && onset[index] >= onset[index + 1]
    ) {
      firstBeatFrame = index;
      break;
    }
  }
  if (firstBeatFrame < 0) firstBeatFrame = onset.indexOf(maxOnset);

  const firstBeatSeconds = Math.max(
    0,
    (firstBeatFrame * hopSeconds) + (frameSize / (2 * sampleRate))
  );
  const confidence = clamp(
    (selectedCorrelation * 0.85)
      + (clamp((selectedCorrelation - MIN_CORRELATION) / (1 - MIN_CORRELATION), 0, 1) * 0.15),
    0,
    1
  );

  const downbeat = estimateDownbeat(
    onset,
    firstBeatFrame,
    refinedLag,
    hopSeconds,
    firstBeatSeconds
  );

  return {
    bpm: Number(bpm.toFixed(3)),
    firstBeatSeconds: Number(firstBeatSeconds.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    ...(downbeat ?? {})
  };
}

export const decodeTrackToPcm: RhythmAnalysisRunner = (
  command,
  filePath,
  signal
) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new Error('Análise rítmica cancelada.'));
    return;
  }

  const child = spawn(command, [
    '-v', 'error',
    '-nostdin',
    '-i', filePath,
    '-t', String(RHYTHM_ANALYSIS_SECONDS),
    '-vn',
    '-ac', '1',
    '-ar', String(RHYTHM_ANALYSIS_SAMPLE_RATE),
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

  const onAbort = () => failAndKill('Análise rítmica cancelada.');
  signal?.addEventListener('abort', onAbort, { once: true });

  timeout = setTimeout(() => {
    failAndKill('FFmpeg excedeu o timeout da análise rítmica.');
  }, RHYTHM_ANALYSIS_TIMEOUT_MS);
  timeout.unref();

  child.stdout.on('data', (chunk: Buffer) => {
    if (settled) return;
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > MAX_PCM_BYTES) {
      failAndKill('FFmpeg excedeu o limite de PCM da análise rítmica.');
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
        finish(new RhythmAnalysisUnavailableError(code));
      } else {
        finish(new Error(`FFmpeg encerrou a análise rítmica com código ${code ?? 'desconhecido'}.`));
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

export async function analyzeTrackRhythm(
  libraryRoot: string,
  track: IndexedTrack,
  ffmpegCommand: string,
  signal?: AbortSignal,
  runner: RhythmAnalysisRunner = decodeTrackToPcm
): Promise<TrackRhythm | null> {
  const before = await resolveRegularFileInside(libraryRoot, track.filePath);
  if (!signatureMatches(track, before.stat)) return null;

  const samples = await runner(ffmpegCommand, before.path, signal);
  const rhythm = analyzePcmRhythm(samples, RHYTHM_ANALYSIS_SAMPLE_RATE);
  if (!rhythm) return null;

  const after = await resolveRegularFileInside(libraryRoot, track.filePath);
  if (!signatureMatches(track, after.stat)) return null;
  return rhythm;
}
