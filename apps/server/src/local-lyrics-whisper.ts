import { constants, createWriteStream } from 'node:fs';
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { LyricsResponse, Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantConfidenceBand,
  type LibraryAssistantReasonCode,
  type LocalLyricsCapabilityResponse,
  type LocalLyricsEligibleTracksResponse,
  type LocalLyricsJob,
  type LocalLyricsMode,
  type LocalLyricsPreviewLine,
  type LocalLyricsQuality,
  type LocalLyricsStartJobRequest
} from '@home-music/shared/library-assistant';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import { HeavyWorkQueueAbortedError, HeavyWorkQueueSaturatedError } from './heavy-work-queue.js';
import type { LibraryAssistantStore } from './library-assistant-store.js';
import { isPathInside, openRegularFileInside } from './security.js';
import type { TrackLyricsOverrideStore } from './track-lyrics-overrides.js';
import type { LocalLyricsCandidateStore } from './local-lyrics-candidates.js';
import { LocalWhisperProcessError, runBoundedProcess } from './local-whisper-process.js';

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_DURATION_SECONDS = 3 * 60 * 60;
const MAX_MODEL_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
const MAX_WHISPER_JSON_BYTES = 4 * 1024 * 1024;
const MAX_JOB_HISTORY = 100;
const MAX_PREVIEW_LINES = 500;
const MAX_ELIGIBLE_TRACKS = 100;
const LANGUAGE_HINT = /^[A-Za-z]{2,3}$/;

type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

type WhisperResult = {
  language: string | null;
  segments: WhisperSegment[];
};

type LocalLyricsLibrary = {
  listTracks: () => Track[];
  revision: () => number;
  root: () => string;
  resolveTrackFile: (trackId: string) => string | null;
  readEffectiveLyrics: (trackId: string) => Promise<LyricsResponse | null>;
};

type LocalLyricsWhisperOptions = {
  library: LocalLyricsLibrary;
  queue: HeavyWorkQueue;
  assistantStore: LibraryAssistantStore;
  candidates: LocalLyricsCandidateStore;
  lyricsOverrides: TrackLyricsOverrideStore;
  whisperCommand?: string;
  modelPath?: string;
  ffmpegCommand?: string;
  timeoutMs?: number;
  maxSourceBytes?: number;
  maxDurationSeconds?: number;
  now?: () => Date;
};

type MutableJob = LocalLyricsJob & {
  ownerId: string;
};

function positiveInteger(value: number | undefined, fallback: number, maximum: number) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) return fallback;
  return value;
}

function cleanLanguage(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z-]{2,32}$/.test(trimmed) ? trimmed : null;
}

function cleanPreview(value: string, maximum = 180) {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizeText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function tokenSimilarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of b) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of a) {
    const available = counts.get(token) ?? 0;
    if (available < 1) continue;
    overlap += 1;
    counts.set(token, available - 1);
  }
  const precision = overlap / b.length;
  const recall = overlap / a.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function timestampSeconds(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(',', '.');
  const parts = trimmed.split(':').map(Number);
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseWhisperJson(value: unknown): WhisperResult {
  const root = objectValue(value);
  if (!root) throw new Error('Saída JSON do Whisper inválida.');
  const result = objectValue(root.result);
  const language = cleanLanguage(result?.language ?? root.language);
  const segments: WhisperSegment[] = [];

  const transcription = Array.isArray(root.transcription) ? root.transcription : [];
  for (const raw of transcription) {
    const item = objectValue(raw);
    if (!item) continue;
    const timestamps = objectValue(item.timestamps);
    const start = timestampSeconds(timestamps?.from ?? objectValue(item.offsets)?.from);
    const end = timestampSeconds(timestamps?.to ?? objectValue(item.offsets)?.to);
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (start == null || !text) continue;
    segments.push({ start, end: end != null && end >= start ? end : start, text });
  }

  const openAiSegments = Array.isArray(root.segments) ? root.segments : [];
  if (segments.length === 0) {
    for (const raw of openAiSegments) {
      const item = objectValue(raw);
      if (!item) continue;
      const start = timestampSeconds(item.start);
      const end = timestampSeconds(item.end);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (start == null || !text) continue;
      segments.push({ start, end: end != null && end >= start ? end : start, text });
    }
  }

  segments.sort((left, right) => left.start - right.start || left.end - right.end);
  if (segments.length === 0) throw new Error('Whisper não retornou segmentos com timestamps.');
  return { language, segments };
}

function formatLrcTimestamp(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `[${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}]`;
}

function asLrc(lines: readonly LocalLyricsPreviewLine[]) {
  return lines.map(line => `${formatLrcTimestamp(line.time ?? 0)}${line.text}`).join('\n');
}

export function fingerprintEffectiveLyrics(lyrics: LyricsResponse | null) {
  return createHash('sha256').update(JSON.stringify(lyrics ? {
    source: lyrics.source,
    synchronized: lyrics.synchronized,
    lines: lyrics.lines.map(line => ({ time: line.time, text: line.text }))
  } : null)).digest('hex');
}

function premiseSignature(track: Track) {
  const common = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist
  };
  const premise = { ...common, duration: track.duration };
  return createHash('sha256').update(JSON.stringify({ capability: 'lyrics', premise })).digest('hex');
}

function transcriptionCandidate(result: WhisperResult, durationSeconds: number | null) {
  const lines: LocalLyricsPreviewLine[] = result.segments
    .filter(segment => segment.text.trim())
    .slice(0, MAX_PREVIEW_LINES)
    .map(segment => ({ time: segment.start, text: segment.text.trim(), state: 'aligned' as const }));
  if (lines.length === 0) throw new Error('Whisper não retornou texto utilizável.');
  const maxTimestampSeconds = lines.at(-1)?.time ?? null;
  const quality: LocalLyricsQuality = {
    totalLines: lines.length,
    alignedLines: lines.length,
    lowConfidenceLines: 0,
    unalignedLines: 0,
    coverage: 1,
    monotonic: true,
    divergence: 0,
    durationSeconds,
    maxTimestampSeconds
  };
  return { lines, quality };
}

type AlignmentMatch = { start: number; score: number } | null;

function alignPlainLyrics(
  plainLines: readonly string[],
  segments: readonly WhisperSegment[],
  durationSeconds: number | null
) {
  const matches: AlignmentMatch[] = [];
  let cursor = 0;
  for (const sourceLine of plainLines) {
    let best: { start: number; score: number; nextCursor: number } | null = null;
    const end = Math.min(segments.length, cursor + 10);
    for (let index = cursor; index < end; index += 1) {
      for (let width = 1; width <= 3 && index + width <= end; width += 1) {
        const candidate = segments.slice(index, index + width).map(segment => segment.text).join(' ');
        const score = tokenSimilarity(sourceLine, candidate);
        if (!best || score > best.score) {
          best = { start: segments[index].start, score, nextCursor: index + width };
        }
      }
    }
    if (best && best.score >= 0.45) {
      matches.push({ start: best.start, score: best.score });
      cursor = best.nextCursor;
    } else {
      matches.push(null);
    }
  }

  const times = matches.map(match => match?.start ?? null) as Array<number | null>;
  for (let index = 0; index < times.length; index += 1) {
    if (times[index] != null) continue;
    let previousIndex = index - 1;
    while (previousIndex >= 0 && times[previousIndex] == null) previousIndex -= 1;
    let nextIndex = index + 1;
    while (nextIndex < times.length && times[nextIndex] == null) nextIndex += 1;
    const previous = previousIndex >= 0 ? times[previousIndex] : null;
    const next = nextIndex < times.length ? times[nextIndex] : null;
    if (previous != null && next != null && next > previous) {
      const fraction = (index - previousIndex) / (nextIndex - previousIndex);
      times[index] = previous + (next - previous) * fraction;
    } else if (previous != null) {
      times[index] = previous + Math.max(0.5, (index - previousIndex) * 1.25);
    } else if (next != null) {
      times[index] = Math.max(0, next - Math.max(0.5, (nextIndex - index) * 1.25));
    } else {
      const span = durationSeconds && durationSeconds > 0 ? durationSeconds : Math.max(1, plainLines.length * 2);
      times[index] = (span * index) / Math.max(1, plainLines.length);
    }
  }

  let previous = -0.02;
  const upperBound = durationSeconds && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const value = Math.max(previous + 0.02, times[index] ?? 0);
    times[index] = Math.min(value, upperBound);
    previous = times[index] ?? previous;
  }

  const lines: LocalLyricsPreviewLine[] = plainLines.map((text, index) => {
    const match = matches[index];
    return {
      time: times[index],
      text,
      state: match == null ? 'unaligned' : match.score >= 0.68 ? 'aligned' : 'low-confidence'
    };
  });
  const alignedLines = lines.filter(line => line.state === 'aligned').length;
  const lowConfidenceLines = lines.filter(line => line.state === 'low-confidence').length;
  const unalignedLines = lines.filter(line => line.state === 'unaligned').length;
  const totalLines = lines.length;
  const coverage = totalLines === 0 ? 0 : (alignedLines + lowConfidenceLines) / totalLines;
  const divergence = totalLines === 0 ? 1 : Math.min(1, (unalignedLines + lowConfidenceLines * 0.5) / totalLines);
  const monotonic = lines.every((line, index) => index === 0 || (line.time ?? 0) >= (lines[index - 1].time ?? 0));
  const maxTimestampSeconds = lines.at(-1)?.time ?? null;
  const quality: LocalLyricsQuality = {
    totalLines,
    alignedLines,
    lowConfidenceLines,
    unalignedLines,
    coverage,
    monotonic,
    divergence,
    durationSeconds,
    maxTimestampSeconds
  };
  return { lines, quality };
}

function isReliablePlainLyrics(lyrics: LyricsResponse | null) {
  if (!lyrics || lyrics.synchronized) return false;
  const lines = lyrics.lines.map(line => line.text.trim()).filter(Boolean);
  return lines.length >= 2 && lines.join(' ').length >= 12;
}

function actionForLyrics(lyrics: LyricsResponse | null): LocalLyricsMode | null {
  if (lyrics?.synchronized) return null;
  return isReliablePlainLyrics(lyrics) ? 'align' : 'transcribe';
}

function cloneJob(job: MutableJob): LocalLyricsJob {
  const { ownerId: _ownerId, ...publicJob } = job;
  return {
    ...publicJob,
    previewLines: publicJob.previewLines.map(line => ({ ...line })),
    quality: publicJob.quality ? { ...publicJob.quality } : null
  };
}

export class LocalLyricsWhisperService {
  private readonly whisperCommand: string;
  private readonly modelPath: string;
  private readonly ffmpegCommand: string;
  private readonly timeoutMs: number;
  private readonly maxSourceBytes: number;
  private readonly maxDurationSeconds: number;
  private readonly now: () => Date;
  private readonly jobs = new Map<string, MutableJob>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<void>>();
  private closed = false;

  constructor(private readonly options: LocalLyricsWhisperOptions) {
    this.whisperCommand = (options.whisperCommand ?? process.env.HOME_MUSIC_WHISPER_PATH ?? '').trim();
    this.modelPath = (options.modelPath ?? process.env.HOME_MUSIC_WHISPER_MODEL ?? '').trim();
    this.ffmpegCommand = (options.ffmpegCommand ?? process.env.HOME_MUSIC_FFMPEG_PATH ?? 'ffmpeg').trim() || 'ffmpeg';
    this.timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 6 * 60 * 60_000);
    this.maxSourceBytes = positiveInteger(options.maxSourceBytes, DEFAULT_MAX_SOURCE_BYTES, 4 * 1024 * 1024 * 1024);
    this.maxDurationSeconds = positiveInteger(options.maxDurationSeconds, DEFAULT_MAX_DURATION_SECONDS, 24 * 60 * 60);
    this.now = options.now ?? (() => new Date());
  }

  async capability(): Promise<LocalLyricsCapabilityResponse> {
    if (!this.whisperCommand) {
      return this.unavailable('not-configured', 'Configure HOME_MUSIC_WHISPER_PATH para habilitar o fallback local.');
    }
    if (!path.isAbsolute(this.whisperCommand)) {
      return this.unavailable('invalid-command', 'HOME_MUSIC_WHISPER_PATH deve apontar para um executável local absoluto.');
    }
    try {
      const entry = await lstat(this.whisperCommand);
      if (!entry.isFile()) return this.unavailable('invalid-command', 'O executável Whisper configurado não é um arquivo regular.');
      await access(this.whisperCommand, process.platform === 'win32' ? constants.R_OK : constants.R_OK | constants.X_OK);
    } catch {
      return this.unavailable('whisper-unavailable', 'O executável Whisper configurado não está disponível para execução.');
    }
    if (!this.modelPath) {
      return this.unavailable('model-not-configured', 'Configure HOME_MUSIC_WHISPER_MODEL com um modelo instalado pelo operador.');
    }

    let modelInfo;
    try {
      const entry = await lstat(this.modelPath);
      if (!entry.isFile()) return this.unavailable('model-invalid', 'O modelo Whisper configurado não é um arquivo regular.');
      await access(this.modelPath, constants.R_OK);
      modelInfo = await stat(this.modelPath);
    } catch {
      return this.unavailable('model-invalid', 'O modelo Whisper configurado não pode ser lido.');
    }
    if (modelInfo.size > MAX_MODEL_BYTES) {
      return this.unavailable('model-too-large', 'O modelo Whisper excede o limite de segurança configurado.');
    }

    try {
      await runBoundedProcess({
        command: this.ffmpegCommand,
        args: ['-version'],
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024
      });
    } catch {
      return this.unavailable('ffmpeg-unavailable', 'FFmpeg é necessário para preparar áudio PCM localmente.');
    }

    let whisperVersion: string | null = null;
    try {
      const probe = await runBoundedProcess({
        command: this.whisperCommand,
        args: ['--version'],
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024
      });
      whisperVersion = cleanPreview(probe.stdout || probe.stderr, 120) || null;
    } catch {
      try {
        const probe = await runBoundedProcess({
          command: this.whisperCommand,
          args: ['-h'],
          timeoutMs: 5_000,
          maxOutputBytes: 64 * 1024
        });
        whisperVersion = cleanPreview(probe.stdout || probe.stderr, 120) || null;
      } catch {
        return this.unavailable('whisper-unavailable', 'O executável Whisper não respondeu ao probe de capacidade.');
      }
    }

    return {
      available: true,
      issue: null,
      action: null,
      whisperVersion,
      model: {
        configured: true,
        label: path.basename(this.modelPath),
        sizeBytes: modelInfo.size
      }
    };
  }

  async eligibleTracks(query = '', limit = 50): Promise<LocalLyricsEligibleTracksResponse> {
    const normalizedQuery = normalizeText(query);
    const safeLimit = Math.max(1, Math.min(MAX_ELIGIBLE_TRACKS, Math.trunc(limit)));
    const tracks = [] as LocalLyricsEligibleTracksResponse['tracks'];
    for (const track of this.options.library.listTracks()) {
      if (tracks.length >= safeLimit) break;
      if (normalizedQuery && !normalizeText(`${track.title} ${track.artist} ${track.album}`).includes(normalizedQuery)) continue;
      const lyrics = await this.options.library.readEffectiveLyrics(track.id);
      const action = actionForLyrics(lyrics);
      if (!action) continue;
      tracks.push({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        action,
        currentSynchronized: Boolean(lyrics?.synchronized)
      });
    }
    return { tracks };
  }

  async startJob(request: LocalLyricsStartJobRequest, ownerId?: string | null) {
    if (this.closed) throw new Error('Serviço de lyrics local encerrado.');
    const capability = await this.capability();
    if (!capability.available) {
      const error = new Error(capability.action ?? 'Whisper local indisponível.') as Error & { statusCode?: number };
      error.statusCode = 503;
      throw error;
    }
    if (!request || typeof request.trackId !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(request.trackId)) {
      throw new TypeError('Faixa inválida.');
    }
    if (request.mode !== 'transcribe' && request.mode !== 'align') throw new TypeError('Modo de lyrics local inválido.');
    const languageHint = request.languageHint == null || request.languageHint === ''
      ? null
      : typeof request.languageHint === 'string' && LANGUAGE_HINT.test(request.languageHint.trim())
        ? request.languageHint.trim().toLocaleLowerCase('en-US')
        : undefined;
    if (languageHint === undefined) throw new TypeError('Idioma opcional inválido.');

    const track = this.options.library.listTracks().find(item => item.id === request.trackId);
    const filePath = this.options.library.resolveTrackFile(request.trackId);
    const root = this.options.library.root();
    if (!track || !filePath || !root) {
      const error = new Error('Faixa não encontrada.') as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    if (track.duration == null || track.duration <= 0 || track.duration > this.maxDurationSeconds) {
      const error = new Error('A faixa não possui duração confiável dentro do limite para processamento local.') as Error & { statusCode?: number };
      error.statusCode = 409;
      throw error;
    }
    const baseLyrics = await this.options.library.readEffectiveLyrics(track.id);
    const expectedAction = actionForLyrics(baseLyrics);
    if (expectedAction !== request.mode) {
      const error = new Error(expectedAction == null
        ? 'A faixa já possui lyrics sincronizadas.'
        : `A ação disponível para esta faixa é ${expectedAction === 'align' ? 'sincronizar' : 'transcrever'}.`) as Error & { statusCode?: number };
      error.statusCode = 409;
      throw error;
    }

    const id = `localjob:${randomUUID()}`;
    const createdAt = this.now().toISOString();
    const job: MutableJob = {
      id,
      trackId: track.id,
      mode: request.mode,
      status: 'queued',
      stage: 'Aguardando recursos locais',
      createdAt,
      startedAt: null,
      finishedAt: null,
      candidateSuggestionId: null,
      error: null,
      quality: null,
      previewLines: [],
      ownerId: ownerId?.trim() || 'admin'
    };
    this.jobs.set(id, job);
    this.pruneJobs();
    const controller = new AbortController();
    this.aborts.set(id, controller);
    const promise = this.options.queue.runWithContext(
      { ownerId: `local-lyrics:${job.ownerId}`, signal: controller.signal },
      signal => this.execute(job, track, filePath, root, baseLyrics, languageHint, signal ?? controller.signal)
    ).catch(error => this.failJob(job, error)).finally(() => {
      this.aborts.delete(id);
      this.running.delete(id);
    });
    this.running.set(id, promise);
    return cloneJob(job);
  }

  getJob(id: string) {
    return this.jobs.has(id) ? cloneJob(this.jobs.get(id)!) : null;
  }

  cancelJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (!['review', 'failed', 'cancelled'].includes(job.status)) {
      this.aborts.get(id)?.abort();
      job.status = 'cancelled';
      job.stage = 'Cancelado';
      job.finishedAt = this.now().toISOString();
      job.error = null;
    }
    return cloneJob(job);
  }

  async close() {
    this.closed = true;
    for (const controller of this.aborts.values()) controller.abort();
    await Promise.allSettled([...this.running.values()]);
  }

  private unavailable(
    issue: NonNullable<LocalLyricsCapabilityResponse['issue']>,
    action: string
  ): LocalLyricsCapabilityResponse {
    return {
      available: false,
      issue,
      action,
      whisperVersion: null,
      model: {
        configured: Boolean(this.modelPath),
        label: this.modelPath ? path.basename(this.modelPath) : null,
        sizeBytes: null
      }
    };
  }

  private async execute(
    job: MutableJob,
    track: Track,
    filePath: string,
    root: string,
    baseLyrics: LyricsResponse | null,
    languageHint: string | null,
    signal: AbortSignal
  ) {
    if (signal.aborted) throw new LocalWhisperProcessError('aborted', 'Processamento cancelado.');
    job.status = 'preparing';
    job.stage = 'Preparando áudio PCM';
    job.startedAt = this.now().toISOString();

    const opened = await openRegularFileInside(root, filePath);
    if (opened.stat.size > this.maxSourceBytes) {
      await opened.handle.close();
      throw new RangeError('Arquivo de origem excede o limite para processamento local.');
    }

    const scratch = await mkdtemp(path.join(os.tmpdir(), 'home-music-whisper-'));
    try {
      const scratchReal = await realpath(scratch);
      if (isPathInside(root, scratchReal)) throw new Error('Scratch local não pode ficar dentro de MUSIC_DIR.');
      const sourcePath = path.join(scratchReal, 'source.audio');
      const wavPath = path.join(scratchReal, 'input.wav');
      const outputBase = path.join(scratchReal, 'whisper');
      const outputJson = `${outputBase}.json`;

      try {
        await pipeline(
          opened.handle.createReadStream({ autoClose: false }),
          createWriteStream(sourcePath, { flags: 'wx', mode: 0o600 })
        );
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
      if (signal.aborted) throw new LocalWhisperProcessError('aborted', 'Processamento cancelado.');

      await runBoundedProcess({
        command: this.ffmpegCommand,
        args: [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
          '-i', sourcePath,
          '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath
        ],
        timeoutMs: Math.min(this.timeoutMs, 10 * 60_000),
        maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
        signal
      });
      await rm(sourcePath, { force: true });

      job.status = 'recognizing';
      job.stage = 'Reconhecendo voz localmente';
      const whisperArgs = ['-m', this.modelPath, '-f', wavPath, '-oj', '-of', outputBase];
      if (languageHint) whisperArgs.push('-l', languageHint);
      else whisperArgs.push('-l', 'auto');
      await runBoundedProcess({
        command: this.whisperCommand,
        args: whisperArgs,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
        signal,
        cwd: scratchReal
      });

      const jsonInfo = await stat(outputJson);
      if (!jsonInfo.isFile() || jsonInfo.size < 2 || jsonInfo.size > MAX_WHISPER_JSON_BYTES) {
        throw new RangeError('Saída JSON do Whisper fora do limite permitido.');
      }
      const parsed = JSON.parse(await readFile(outputJson, 'utf8')) as unknown;
      const whisper = parseWhisperJson(parsed);

      let candidate;
      if (job.mode === 'transcribe') {
        candidate = transcriptionCandidate(whisper, track.duration);
      } else {
        job.status = 'aligning';
        job.stage = 'Alinhando letra existente';
        const plainLines = (baseLyrics?.lines ?? []).map(line => line.text.trim()).filter(Boolean);
        if (plainLines.length < 2) throw new Error('A letra-base deixou de ser adequada para alinhamento.');
        candidate = alignPlainLyrics(plainLines, whisper.segments, track.duration);
      }
      if (signal.aborted) throw new LocalWhisperProcessError('aborted', 'Processamento cancelado.');

      const currentLyrics = await this.options.library.readEffectiveLyrics(track.id);
      const baseFingerprint = fingerprintEffectiveLyrics(baseLyrics);
      if (fingerprintEffectiveLyrics(currentLyrics) !== baseFingerprint) {
        throw new Error('A letra efetiva mudou durante o processamento. Execute novamente.');
      }

      const source = job.mode === 'align' ? 'local-alignment' : 'local-transcription';
      const candidateId = `local:${randomUUID()}`;
      const capability = await this.capability();
      if (!capability.available) throw new Error(capability.action ?? 'Whisper local deixou de estar disponível.');
      const stored = this.options.candidates.save({
        id: candidateId,
        trackId: track.id,
        source,
        text: asLrc(candidate.lines),
        language: whisper.language ?? languageHint,
        providerVersion: capability.whisperVersion,
        modelLabel: capability.model.label ?? 'modelo local',
        baseLyricsFingerprint: baseFingerprint,
        quality: candidate.quality,
        previewLines: candidate.lines.slice(0, MAX_PREVIEW_LINES)
      });

      const runId = `localrun:${randomUUID()}`;
      const suggestionId = `localsuggestion:${randomUUID()}`;
      const timestamp = this.now().toISOString();
      this.options.assistantStore.createRun({
        id: runId,
        capability: 'lyrics',
        libraryRevision: this.options.library.revision(),
        createdAt: timestamp
      });
      this.options.assistantStore.startRun(runId, timestamp);
      const reasons: LibraryAssistantReasonCode[] = [source, 'local-review'];
      if (candidate.quality.coverage < 1 || candidate.quality.unalignedLines > 0) reasons.push('alignment-partial');
      if (candidate.quality.lowConfidenceLines > 0 || candidate.quality.divergence > 0.2) reasons.push('alignment-low-confidence');
      const confidence: LibraryAssistantConfidenceBand = source === 'local-transcription'
        ? 'low'
        : candidate.quality.coverage >= 0.9 && candidate.quality.divergence <= 0.1
          ? 'medium'
          : 'low';
      try {
        this.options.assistantStore.insertSuggestions([{
          id: suggestionId,
          runId,
          capability: 'lyrics',
          trackId: track.id,
          status: 'review',
          confidence,
          reasonCodes: reasons,
          evidence: [{
            type: 'duration-delta',
            version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
            deltaSeconds: stored.quality.maxTimestampSeconds == null || track.duration == null
              ? 0
              : stored.quality.maxTimestampSeconds - track.duration
          }],
          provenance: {
            source,
            providerVersion: stored.providerVersion,
            externalId: stored.id
          },
          target: {
            capability: 'lyrics',
            trackId: track.id,
            candidateId: stored.id,
            synchronized: true,
            language: stored.language,
            currentValue: `effective:${baseFingerprint}`,
            preview: cleanPreview(stored.previewLines.map(line => line.text).join(' ')),
            source
          },
          premiseSignature: premiseSignature(track),
          createdAt: timestamp
        }]);
        this.options.assistantStore.completeRun(runId, this.now().toISOString());
      } catch (error) {
        this.options.assistantStore.failRun(runId, this.now().toISOString(), {
          code: 'local-lyrics-suggestion-failed',
          message: 'Não foi possível preparar a sugestão local para revisão.',
          action: 'Execute o processamento local novamente.'
        });
        this.options.candidates.delete(candidateId);
        throw error;
      }

      job.status = 'review';
      job.stage = 'Pronto para revisão humana';
      job.finishedAt = this.now().toISOString();
      job.candidateSuggestionId = suggestionId;
      job.quality = { ...stored.quality };
      job.previewLines = stored.previewLines.map(line => ({ ...line }));
      job.error = null;
    } finally {
      await opened.handle.close().catch(() => undefined);
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private failJob(job: MutableJob, error: unknown) {
    if (job.status === 'cancelled') return;
    if (error instanceof HeavyWorkQueueAbortedError || (
      error instanceof LocalWhisperProcessError && error.code === 'aborted'
    )) {
      job.status = 'cancelled';
      job.stage = 'Cancelado';
      job.finishedAt = this.now().toISOString();
      job.error = null;
      return;
    }
    job.status = 'failed';
    job.stage = error instanceof HeavyWorkQueueSaturatedError ? 'Fila local saturada' : 'Falha no processamento local';
    job.finishedAt = this.now().toISOString();
    job.error = error instanceof HeavyWorkQueueSaturatedError
      ? 'A fila de tarefas pesadas está ocupada. Tente novamente depois.'
      : error instanceof LocalWhisperProcessError
        ? error.message
        : error instanceof Error
          ? error.message.slice(0, 320)
          : 'Falha inesperada no processamento local.';
  }

  private pruneJobs() {
    if (this.jobs.size <= MAX_JOB_HISTORY) return;
    const removable = [...this.jobs.values()]
      .filter(job => ['review', 'failed', 'cancelled'].includes(job.status))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    while (this.jobs.size > MAX_JOB_HISTORY && removable.length > 0) {
      this.jobs.delete(removable.shift()!.id);
    }
  }
}
