import { execFile } from 'node:child_process';
import path from 'node:path';
import type {
  AdminLibraryIntegrityIssue,
  AdminLibraryIntegrityIssueKind,
  AdminLibraryIntegrityStatus
} from '@home-music/shared';

const FFPROBE_TIMEOUT_MS = 5_000;
const FFPROBE_MAX_BUFFER_BYTES = 64 * 1024;
const MAX_ISSUE_MESSAGE_LENGTH = 240;

type ActiveIntegrityCheck = {
  libraryRoot: string;
  issues: AdminLibraryIntegrityIssue[];
};

type FfprobeRunResult = {
  stdout: string;
  stderr: string;
};

export type FfprobeRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<FfprobeRunResult>;

export type MediaFileProbeResult = {
  status: 'ok' | 'failed' | 'unavailable';
  message: string | null;
};

const EMPTY_COUNTS: AdminLibraryIntegrityStatus['counts'] = {
  total: 0,
  scannerFailures: 0,
  mediaProbeFailures: 0,
  missingFiles: 0,
  unindexedFiles: 0
};

let activeCheck: ActiveIntegrityCheck | null = null;
let lastLibraryRoot: string | null = null;
let lastStatus: AdminLibraryIntegrityStatus = {
  checkedAt: null,
  counts: { ...EMPTY_COUNTS },
  issues: []
};

function normalizedRelativePath(libraryRoot: string, filePath: string) {
  const relative = path.relative(libraryRoot, filePath).split(path.sep).join('/');
  return relative || path.basename(filePath);
}

function compactMessage(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.slice(0, MAX_ISSUE_MESSAGE_LENGTH);
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Falha desconhecida.';
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String(error.code || '');
}

function errorWasKilled(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'killed' in error && error.killed);
}

function errorStderr(error: unknown) {
  if (!error || typeof error !== 'object' || !('stderr' in error)) return '';
  return typeof error.stderr === 'string' ? error.stderr : '';
}

function isPersistentFileFailure(issue: AdminLibraryIntegrityIssue) {
  return issue.kind === 'scanner-failed' || issue.kind === 'media-probe-failed';
}

export function resolveFfprobeCommand(rawFfmpegCommand: string | undefined) {
  const configured = rawFfmpegCommand?.trim();
  if (!configured) return 'ffprobe';
  if (configured.includes('\0') || configured.length > 1_024) return null;

  const basename = path.basename(configured);
  const match = /^ffmpeg(\.exe)?$/i.exec(basename);
  if (!match) return null;
  const ffprobeName = match[1] ? 'ffprobe.exe' : 'ffprobe';
  const directory = path.dirname(configured);
  return directory === '.' ? ffprobeName : path.join(directory, ffprobeName);
}

export const runFfprobe: FfprobeRunner = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(command, [...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: FFPROBE_MAX_BUFFER_BYTES,
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

export async function probeMediaFile(
  filePath: string,
  rawFfmpegCommand = process.env.HOME_MUSIC_FFMPEG_PATH,
  runner: FfprobeRunner = runFfprobe,
  timeoutMs = FFPROBE_TIMEOUT_MS
): Promise<MediaFileProbeResult> {
  const command = resolveFfprobeCommand(rawFfmpegCommand);
  if (!command) {
    return {
      status: 'unavailable',
      message: 'ffprobe não pode ser derivado de HOME_MUSIC_FFMPEG_PATH.'
    };
  }

  try {
    await runner(command, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], timeoutMs);
    return { status: 'ok', message: null };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') {
      return { status: 'unavailable', message: 'ffprobe não está disponível no ambiente.' };
    }
    if (code === 'ETIMEDOUT' || errorWasKilled(error)) {
      return { status: 'failed', message: 'ffprobe excedeu o tempo limite para este arquivo.' };
    }
    return {
      status: 'failed',
      message: compactMessage(errorStderr(error) || errorText(error), 'ffprobe rejeitou o arquivo.')
    };
  }
}

export function beginLibraryIntegrityCheck(libraryRoot: string) {
  activeCheck = {
    libraryRoot,
    issues: lastLibraryRoot === libraryRoot
      ? lastStatus.issues.filter(isPersistentFileFailure).map(issue => ({ ...issue }))
      : []
  };
}

export function hasLibraryIntegrityFileFailure(filePath: string) {
  if (!activeCheck) return false;
  const relativePath = normalizedRelativePath(activeCheck.libraryRoot, filePath);
  return activeCheck.issues.some(issue => isPersistentFileFailure(issue) && issue.relativePath === relativePath);
}

export function clearLibraryIntegrityFileFailures(filePath: string) {
  if (!activeCheck) return;
  const relativePath = normalizedRelativePath(activeCheck.libraryRoot, filePath);
  activeCheck.issues = activeCheck.issues.filter(issue =>
    !isPersistentFileFailure(issue) || issue.relativePath !== relativePath
  );
}

export function recordLibraryIntegrityIssue(input: {
  kind: AdminLibraryIntegrityIssueKind;
  filePath: string;
  trackId?: string | null;
  message: string;
}) {
  if (!activeCheck) return;
  activeCheck.issues.push({
    kind: input.kind,
    trackId: input.trackId ?? null,
    relativePath: normalizedRelativePath(activeCheck.libraryRoot, input.filePath),
    message: compactMessage(input.message, 'Inconsistência detectada na biblioteca.')
  });
}

function countsFor(issues: readonly AdminLibraryIntegrityIssue[]): AdminLibraryIntegrityStatus['counts'] {
  return {
    total: issues.length,
    scannerFailures: issues.filter(issue => issue.kind === 'scanner-failed').length,
    mediaProbeFailures: issues.filter(issue => issue.kind === 'media-probe-failed').length,
    missingFiles: issues.filter(issue => issue.kind === 'missing-file').length,
    unindexedFiles: issues.filter(issue => issue.kind === 'unindexed-file').length
  };
}

export function finishLibraryIntegrityCheck(checkedAt = new Date().toISOString()) {
  if (!activeCheck) return getLibraryIntegrityStatus();
  const deduplicated = new Map<string, AdminLibraryIntegrityIssue>();
  for (const issue of activeCheck.issues) {
    deduplicated.set(`${issue.kind}\0${issue.trackId || ''}\0${issue.relativePath}`, issue);
  }
  const issues = [...deduplicated.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'pt-BR') || left.kind.localeCompare(right.kind)
  );
  lastLibraryRoot = activeCheck.libraryRoot;
  lastStatus = {
    checkedAt,
    counts: countsFor(issues),
    issues
  };
  activeCheck = null;
  return getLibraryIntegrityStatus();
}

export function abortLibraryIntegrityCheck() {
  activeCheck = null;
}

export function getLibraryIntegrityStatus(): AdminLibraryIntegrityStatus {
  return {
    checkedAt: lastStatus.checkedAt,
    counts: { ...lastStatus.counts },
    issues: lastStatus.issues.map(issue => ({ ...issue }))
  };
}

export function resetLibraryIntegrityStatusForTests() {
  activeCheck = null;
  lastLibraryRoot = null;
  lastStatus = {
    checkedAt: null,
    counts: { ...EMPTY_COUNTS },
    issues: []
  };
}
