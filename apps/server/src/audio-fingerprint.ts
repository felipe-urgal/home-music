import { execFile } from 'node:child_process';

export const DEFAULT_FPCALC_COMMAND = 'fpcalc';
export const FPCALC_TIMEOUT_MS = 30_000;
const FPCALC_MAX_BUFFER_BYTES = 128 * 1024;
const MAX_FINGERPRINT_CHARS = 64 * 1024;

export type AudioFingerprint = {
  durationSeconds: number;
  fingerprint: string;
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

function parseFingerprintPayload(stdout: string): AudioFingerprint {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('fpcalc retornou JSON inválido.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('fpcalc retornou payload inválido.');
  }
  const record = payload as Record<string, unknown>;
  const duration = Number(record.duration);
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : '';
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60) {
    throw new Error('fpcalc retornou duração inválida.');
  }
  if (
    !fingerprint
    || fingerprint.length > MAX_FINGERPRINT_CHARS
    || !/^[A-Za-z0-9_-]+$/.test(fingerprint)
  ) {
    throw new Error('fpcalc retornou fingerprint inválido.');
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
  const result = await runner(command, ['-json', '-length', '0', '--', filePath], {
    timeoutMs: options.timeoutMs ?? FPCALC_TIMEOUT_MS,
    signal: options.signal
  });
  return parseFingerprintPayload(result.stdout);
}
