import { execFile } from 'node:child_process';

export const DEFAULT_FFMPEG_COMMAND = 'ffmpeg';
export const FFMPEG_PROBE_TIMEOUT_MS = 3_000;
const FFMPEG_PROBE_MAX_BUFFER_BYTES = 64 * 1024;

export type FfmpegIssue = 'invalid-command' | 'not-found' | 'timeout' | 'failed' | 'invalid-output';

export type FfmpegStatus = {
  available: boolean;
  version: string | null;
  issue: FfmpegIssue | null;
  customCommand: boolean;
};

type FfmpegRunResult = {
  stdout: string;
  stderr: string;
};

export type FfmpegRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<FfmpegRunResult>;

export function resolveFfmpegCommand(raw: string | undefined) {
  const command = raw?.trim() || DEFAULT_FFMPEG_COMMAND;
  if (command.includes('\0') || command.length > 1_024) {
    throw new Error('HOME_MUSIC_FFMPEG_PATH inválido.');
  }
  return command;
}

export function parseFfmpegVersion(output: string) {
  for (const line of output.split(/\r?\n/)) {
    const match = /^ffmpeg version\s+(\S+)/i.exec(line.trim());
    if (match?.[1]) return match[1];
  }
  return null;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String(error.code || '');
}

function errorWasKilled(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'killed' in error && error.killed);
}

export const runFfmpegVersion: FfmpegRunner = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(command, [...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: FFMPEG_PROBE_MAX_BUFFER_BYTES,
    windowsHide: true
  }, (error, stdout, stderr) => {
    if (error) {
      const enriched = error as Error & {
        code?: string | number;
        killed?: boolean;
        stdout?: string;
        stderr?: string;
      };
      enriched.stdout = stdout;
      enriched.stderr = stderr;
      reject(enriched);
      return;
    }
    resolve({ stdout, stderr });
  });
});

export async function probeFfmpeg(
  rawCommand: string | undefined,
  runner: FfmpegRunner = runFfmpegVersion,
  timeoutMs = FFMPEG_PROBE_TIMEOUT_MS
): Promise<FfmpegStatus> {
  const customCommand = Boolean(rawCommand?.trim());
  let command: string;

  try {
    command = resolveFfmpegCommand(rawCommand);
  } catch {
    return { available: false, version: null, issue: 'invalid-command', customCommand };
  }

  try {
    const result = await runner(command, ['-version'], timeoutMs);
    const version = parseFfmpegVersion(`${result.stdout}\n${result.stderr}`);
    if (!version) {
      return { available: false, version: null, issue: 'invalid-output', customCommand };
    }
    return { available: true, version, issue: null, customCommand };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') {
      return { available: false, version: null, issue: 'not-found', customCommand };
    }
    if (code === 'ETIMEDOUT' || errorWasKilled(error)) {
      return { available: false, version: null, issue: 'timeout', customCommand };
    }
    return { available: false, version: null, issue: 'failed', customCommand };
  }
}
