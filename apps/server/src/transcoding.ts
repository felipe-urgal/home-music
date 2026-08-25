import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { clampReplayGainDb } from './replay-gain.js';

export const DEFAULT_TRANSCODE_CACHE_MEGABYTES = 512;
export const MIN_TRANSCODE_CACHE_MEGABYTES = 64;
export const MAX_TRANSCODE_CACHE_MEGABYTES = 8_192;
export const DEFAULT_TRANSCODE_TIMEOUT_MS = 120_000;
const TRANSCODE_CACHE_VERSION = 'aac-m4a-v2-replaygain';
const MAX_FFMPEG_STDERR_BYTES = 64 * 1024;

type SeekableInput = Readable & { fd?: number | null };

export const TRANSCODE_PROFILES = {
  economy: { bitrate: '96k', bitsPerSecond: 96_000 },
  balanced: { bitrate: '160k', bitsPerSecond: 160_000 },
  high: { bitrate: '256k', bitsPerSecond: 256_000 }
} as const;

export type TranscodeQuality = keyof typeof TRANSCODE_PROFILES;

export type TranscodeSource = {
  trackId: string;
  sourceSize: number;
  sourceMtimeMs: number;
  quality: TranscodeQuality;
  normalizationGainDb?: number | null;
  createInput: () => SeekableInput;
};

export type PreparedTranscode = {
  path: string;
  size: number;
  cacheHit: boolean;
  quality: TranscodeQuality;
};

export type TranscodeRunnerOptions = {
  command: string;
  input: SeekableInput;
  outputPath: string;
  bitrate: string;
  normalizationGainDb: number | null;
  timeoutMs: number;
};

export type TranscodeRunner = (options: TranscodeRunnerOptions) => Promise<void>;

export class TranscodeExecutionError extends Error {
  constructor(
    public readonly reason: 'spawn' | 'timeout' | 'failed',
    message: string
  ) {
    super(message);
    this.name = 'TranscodeExecutionError';
  }
}

export function parseTranscodeQuality(raw: unknown): TranscodeQuality | null {
  if (raw == null || raw === '') return 'balanced';
  return raw === 'economy' || raw === 'balanced' || raw === 'high' ? raw : null;
}

export function parseTranscodeCacheMegabytes(raw: string | undefined) {
  if (raw == null || raw.trim() === '') return DEFAULT_TRANSCODE_CACHE_MEGABYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_TRANSCODE_CACHE_MEGABYTES || value > MAX_TRANSCODE_CACHE_MEGABYTES) {
    throw new Error(
      `HOME_MUSIC_TRANSCODE_CACHE_MB deve ser inteiro entre ${MIN_TRANSCODE_CACHE_MEGABYTES} e ${MAX_TRANSCODE_CACHE_MEGABYTES}.`
    );
  }
  return value;
}

export function transcodeCacheKey(input: Pick<TranscodeSource, 'trackId' | 'sourceSize' | 'sourceMtimeMs' | 'quality' | 'normalizationGainDb'>) {
  const gain = input.normalizationGainDb == null ? 'off' : clampReplayGainDb(input.normalizationGainDb).toFixed(3);
  return createHash('sha256')
    .update(`${TRANSCODE_CACHE_VERSION}\0${input.trackId}\0${input.sourceSize}\0${input.sourceMtimeMs}\0${input.quality}\0${gain}`)
    .digest('hex');
}

export function seekableInputFd(input: Pick<SeekableInput, 'fd'>) {
  return typeof input.fd === 'number' && Number.isInteger(input.fd) && input.fd >= 0 ? input.fd : null;
}

export const runFfmpegTranscode: TranscodeRunner = ({ command, input, outputPath, bitrate, normalizationGainDb, timeoutMs }) => new Promise((resolve, reject) => {
  const inputFd = seekableInputFd(input);
  if (inputFd === null) {
    input.destroy();
    reject(new TranscodeExecutionError('failed', 'Entrada do FFmpeg não possui descritor seekable.'));
    return;
  }

  // O FileHandle validado pelo servidor é herdado pelo filho como fd 3. O FFmpeg
  // abre /proc/self/fd/3 como arquivo regular: isso preserva seek para M4A/MP4
  // sem reabrir a música pelo caminho original.
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', '/proc/self/fd/3',
    '-map', '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-map_metadata', '-1',
    '-map_chapters', '-1'
  ];

  if (normalizationGainDb != null) {
    const safeGain = clampReplayGainDb(normalizationGainDb).toFixed(3);
    args.push('-filter:a', `volume=${safeGain}dB,alimiter=limit=0.97`);
  }

  args.push(
    '-c:a', 'aac',
    '-b:a', bitrate,
    '-threads', '1',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath
  );

  const child = spawn(command, args, {
    stdio: ['ignore', 'ignore', 'pipe', inputFd],
    windowsHide: true
  });

  let settled = false;
  let timedOut = false;
  let stderr = '';

  function finish(error?: Error) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    input.destroy();
    if (error) reject(error);
    else resolve();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);
  timer.unref();

  child.stderr?.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-MAX_FFMPEG_STDERR_BYTES);
  });

  child.once('error', error => {
    finish(new TranscodeExecutionError('spawn', `Não foi possível iniciar FFmpeg: ${error.message}`));
  });

  child.once('close', code => {
    if (timedOut) {
      finish(new TranscodeExecutionError('timeout', 'FFmpeg excedeu o tempo máximo de transcoding.'));
      return;
    }
    if (code !== 0) {
      const detail = stderr.trim();
      finish(new TranscodeExecutionError('failed', detail ? `FFmpeg falhou: ${detail}` : `FFmpeg encerrou com código ${code}.`));
      return;
    }
    finish();
  });
});

type CacheEntry = {
  path: string;
  size: number;
  mtimeMs: number;
};

export class TranscodeManager {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private initialized: Promise<void> | null = null;

  constructor(private readonly options: {
    cacheDir: string;
    command: string;
    maxCacheBytes: number;
    maxConcurrent?: number;
    timeoutMs?: number;
    runner?: TranscodeRunner;
  }) {}

  get activeCount() {
    return this.active;
  }

  get pendingCount() {
    return this.pending.size;
  }

  get maxCacheBytes() {
    return this.options.maxCacheBytes;
  }

  async prepare(source: TranscodeSource): Promise<PreparedTranscode> {
    await this.initialize();
    const key = transcodeCacheKey(source);
    const finalPath = path.join(this.options.cacheDir, `${key}.m4a`);
    const cached = await this.cachedFile(finalPath);
    if (cached) {
      await this.touch(finalPath);
      return { path: finalPath, size: cached.size, cacheHit: true, quality: source.quality };
    }

    const existing = this.pending.get(finalPath);
    if (existing) {
      await existing;
      const ready = await this.cachedFile(finalPath);
      if (!ready) throw new TranscodeExecutionError('failed', 'Arquivo transcodificado não foi produzido.');
      await this.touch(finalPath);
      return { path: finalPath, size: ready.size, cacheHit: true, quality: source.quality };
    }

    const work = this.withSlot(async () => {
      if (await this.cachedFile(finalPath)) return;

      const temporaryPath = `${finalPath}.tmp-${randomUUID()}`;
      const input = source.createInput();
      try {
        const runner = this.options.runner ?? runFfmpegTranscode;
        await runner({
          command: this.options.command,
          input,
          outputPath: temporaryPath,
          bitrate: TRANSCODE_PROFILES[source.quality].bitrate,
          normalizationGainDb: source.normalizationGainDb == null ? null : clampReplayGainDb(source.normalizationGainDb),
          timeoutMs: this.options.timeoutMs ?? DEFAULT_TRANSCODE_TIMEOUT_MS
        });

        const output = await stat(temporaryPath);
        if (!output.isFile() || output.size <= 0) {
          throw new TranscodeExecutionError('failed', 'FFmpeg produziu um arquivo de áudio vazio ou inválido.');
        }

        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, finalPath);
        await this.enforceLimit(finalPath);
      } finally {
        input.destroy();
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });

    this.pending.set(finalPath, work);
    try {
      await work;
    } finally {
      this.pending.delete(finalPath);
    }

    const ready = await this.cachedFile(finalPath);
    if (!ready) throw new TranscodeExecutionError('failed', 'Arquivo transcodificado não está disponível no cache.');
    await this.touch(finalPath);
    return { path: finalPath, size: ready.size, cacheHit: false, quality: source.quality };
  }

  private initialize() {
    if (!this.initialized) {
      this.initialized = (async () => {
        await mkdir(this.options.cacheDir, { recursive: true, mode: 0o700 });
        await chmod(this.options.cacheDir, 0o700);
        const entries = await readdir(this.options.cacheDir, { withFileTypes: true });
        await Promise.all(entries
          .filter(entry => entry.isFile() && entry.name.includes('.tmp-'))
          .map(entry => rm(path.join(this.options.cacheDir, entry.name), { force: true }))
        );
        await this.enforceLimit();
      })();
    }
    return this.initialized;
  }

  private async cachedFile(filePath: string) {
    try {
      const info = await stat(filePath);
      return info.isFile() && info.size > 0 ? info : null;
    } catch {
      return null;
    }
  }

  private async touch(filePath: string) {
    const now = new Date();
    await utimes(filePath, now, now).catch(() => undefined);
  }

  private async acquireSlot() {
    const maxConcurrent = Math.max(1, this.options.maxConcurrent ?? 1);
    if (this.active >= maxConcurrent) {
      await new Promise<void>(resolve => this.waiters.push(resolve));
    }
    this.active += 1;
  }

  private releaseSlot() {
    this.active = Math.max(0, this.active - 1);
    this.waiters.shift()?.();
  }

  private async withSlot<T>(operation: () => Promise<T>) {
    await this.acquireSlot();
    try {
      return await operation();
    } finally {
      this.releaseSlot();
    }
  }

  private async enforceLimit(keepPath?: string) {
    const entries = await readdir(this.options.cacheDir, { withFileTypes: true });
    const files: CacheEntry[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.m4a')) continue;
      const filePath = path.join(this.options.cacheDir, entry.name);
      try {
        const info = await stat(filePath);
        if (info.isFile()) files.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
      } catch {
        // O arquivo pode ter sido removido por outra limpeza concorrente.
      }
    }

    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const file of files) {
      if (totalBytes <= this.options.maxCacheBytes) break;
      if (file.path === keepPath || this.pending.has(file.path)) continue;
      await rm(file.path, { force: true });
      totalBytes -= file.size;
    }
  }
}
