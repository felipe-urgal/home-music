import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_FPCALC_COMMAND = 'fpcalc';
export const FPCALC_TIMEOUT_MS = 30_000;
const FPCALC_MAX_BUFFER_BYTES = 128 * 1024;
const MAX_FINGERPRINT_CHARS = 64 * 1024;

export type AudioFingerprint = {
  durationSeconds: number;
  fingerprint: string;
};

export type FingerprintFile = {
  filePath: string;
  signature: string;
};

export type FpcalcStatus = {
  available: boolean;
  version: string | null;
  issue: 'invalid-command' | 'not-found' | 'timeout' | 'failed' | 'invalid-output' | null;
};

type FpcalcRunOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
};

export type FpcalcRunner = (
  command: string,
  args: readonly string[],
  options: FpcalcRunOptions
) => Promise<{ stdout: string; stderr: string }>;

export function resolveFpcalcCommand(raw: string | undefined) {
  const command = raw?.trim() || DEFAULT_FPCALC_COMMAND;
  if (command.includes('\0') || command.length > 1_024) {
    throw new Error('HOME_MUSIC_FPCALC_PATH inválido.');
  }
  return command;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String(error.code || '');
}

function errorWasKilled(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'killed' in error && error.killed);
}

function sanitizedProcessError(error: unknown) {
  if (errorCode(error) === 'ENOENT') return new Error('Chromaprint/fpcalc não está disponível no servidor.');
  if (errorCode(error) === 'ETIMEDOUT' || errorWasKilled(error)) {
    return new Error('Chromaprint/fpcalc excedeu o tempo limite.');
  }
  if (errorCode(error) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new Error('Chromaprint/fpcalc excedeu o limite de saída permitido.');
  }
  return new Error('Chromaprint/fpcalc não conseguiu gerar o fingerprint.');
}

function parseFingerprintPayload(stdout: string): AudioFingerprint {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('Chromaprint/fpcalc retornou uma resposta inválida.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Chromaprint/fpcalc retornou uma resposta inválida.');
  }
  const record = payload as Record<string, unknown>;
  const duration = Number(record.duration);
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : '';
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60) {
    throw new Error('Chromaprint/fpcalc retornou duração inválida.');
  }
  if (
    !fingerprint
    || fingerprint.length > MAX_FINGERPRINT_CHARS
    || !/^[A-Za-z0-9_-]+$/.test(fingerprint)
  ) {
    throw new Error('Chromaprint/fpcalc retornou fingerprint inválido.');
  }
  return {
    durationSeconds: Math.max(1, Math.round(duration)),
    fingerprint
  };
}

export const runFpcalc: FpcalcRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, [...args], {
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: FPCALC_MAX_BUFFER_BYTES,
    windowsHide: true,
    signal: options.signal
  }, (error, stdout, stderr) => {
    if (error) {
      const enriched = error as Error & { stdout?: string; stderr?: string };
      enriched.stdout = stdout;
      enriched.stderr = stderr;
      reject(enriched);
      return;
    }
    resolve({ stdout, stderr });
  });
});

export async function resolveFingerprintFile(root: string, indexedFilePath: string): Promise<FingerprintFile> {
  let realRoot: string;
  let realFile: string;
  try {
    [realRoot, realFile] = await Promise.all([realpath(root), realpath(indexedFilePath)]);
  } catch {
    throw new Error('Arquivo da faixa não está mais disponível para fingerprint.');
  }
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Arquivo da faixa não está confinado à biblioteca configurada.');
  }
  const info = await stat(realFile, { bigint: true });
  if (!info.isFile()) throw new Error('A origem da faixa não é um arquivo regular.');
  const signature = createHash('sha256').update(JSON.stringify({
    relative,
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
    ino: String(info.ino)
  })).digest('hex');
  return { filePath: realFile, signature };
}

export async function fingerprintAudioFile(
  filePath: string,
  options: {
    command?: string;
    runner?: FpcalcRunner;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
) {
  const command = resolveFpcalcCommand(options.command);
  const runner = options.runner ?? runFpcalc;
  let result: { stdout: string; stderr: string };
  try {
    result = await runner(command, ['-json', '-length', '0', '--', filePath], {
      timeoutMs: options.timeoutMs ?? FPCALC_TIMEOUT_MS,
      signal: options.signal
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw sanitizedProcessError(error);
  }
  return parseFingerprintPayload(result.stdout);
}

export async function probeFpcalc(
  rawCommand: string | undefined,
  runner: FpcalcRunner = runFpcalc
): Promise<FpcalcStatus> {
  let command: string;
  try {
    command = resolveFpcalcCommand(rawCommand);
  } catch {
    return { available: false, version: null, issue: 'invalid-command' };
  }
  try {
    const result = await runner(command, ['-version'], { timeoutMs: 3_000 });
    const match = /fpcalc version\s+([^\s]+)/i.exec(`${result.stdout}\n${result.stderr}`);
    if (!match?.[1]) return { available: false, version: null, issue: 'invalid-output' };
    return { available: true, version: match[1], issue: null };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { available: false, version: null, issue: 'not-found' };
    if (errorCode(error) === 'ETIMEDOUT' || errorWasKilled(error)) {
      return { available: false, version: null, issue: 'timeout' };
    }
    return { available: false, version: null, issue: 'failed' };
  }
}
