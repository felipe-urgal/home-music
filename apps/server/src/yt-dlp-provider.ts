import { spawn, type ChildProcess } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ExternalProviderError,
  type ExternalProvider,
  type ExternalProviderContext,
  type ExternalProviderPreparedMedia,
  type ExternalProviderRequest
} from './external-provider.js';

const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const TERMINATION_GRACE_MS = 1500;
const OUTPUT_PREFIX = 'home-music-media.';

export const YT_DLP_PROVIDER_ID = 'yt-dlp';
export const YT_DLP_COMMAND_CONFIG = 'command';
export const YT_DLP_EGRESS_LAUNCHER_CONFIG = 'egressLauncher';

export type YtDlpProcessRequest = Readonly<{
  launcherPath: string;
  commandPath: string;
  args: readonly string[];
  cwd: string;
  signal: AbortSignal;
}>;

export type YtDlpProcessResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export type YtDlpProcessRunner = (request: YtDlpProcessRequest) => Promise<YtDlpProcessResult>;

type YtDlpMetadata = {
  id?: unknown;
  title?: unknown;
  artist?: unknown;
  creator?: unknown;
  uploader?: unknown;
  album?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
};

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return clean ? clean.slice(0, 500) : null;
}

function cleanThumbnail(metadata: YtDlpMetadata) {
  const direct = cleanString(metadata.thumbnail);
  if (direct) return direct;
  if (!Array.isArray(metadata.thumbnails)) return null;
  for (let index = metadata.thumbnails.length - 1; index >= 0; index -= 1) {
    const item = metadata.thumbnails[index];
    if (!item || typeof item !== 'object') continue;
    const url = cleanString((item as { url?: unknown }).url);
    if (url) return url;
  }
  return null;
}

function parseMetadata(stdout: string): YtDlpMetadata {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou metadata estruturada.');
  const candidates = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index]) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as YtDlpMetadata;
    } catch {
      // O adapter aceita somente uma linha JSON válida e ignora qualquer ruído anterior do launcher.
    }
  }
  throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou metadata inválida.');
}

function requireAbsoluteExecutable(value: string | undefined, label: string) {
  const clean = value?.trim() ?? '';
  if (!clean || !path.isAbsolute(clean) || clean.includes('\u0000')) {
    throw new ExternalProviderError('provider_failed', `${label} não está configurado com caminho absoluto.`, 503);
  }
  return path.normalize(clean);
}

async function findPreparedOutput(scratchDir: string) {
  const entries = await readdir(scratchDir, { withFileTypes: true });
  const candidates = entries.filter(entry => entry.isFile() && entry.name.startsWith(OUTPUT_PREFIX) && !entry.name.endsWith('.part'));
  if (candidates.length !== 1) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp não produziu exatamente uma mídia candidata.');
  }
  const candidate = candidates[0].name;
  const info = await stat(path.join(scratchDir, candidate));
  if (!info.isFile() || info.size <= 0) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou um arquivo vazio ou inválido.');
  }
  return candidate;
}

function fixedArguments(request: ExternalProviderRequest, scratchDir: string) {
  return Object.freeze([
    '--ignore-config',
    '--no-config-locations',
    '--no-playlist',
    '--no-simulate',
    '--no-progress',
    '--no-warnings',
    '--format', 'bestaudio/best',
    '--paths', `home:${scratchDir}`,
    '--output', `${OUTPUT_PREFIX}%(ext)s`,
    '--dump-single-json',
    '--',
    request.url
  ] as const);
}

function appendBounded(current: string, chunk: Buffer | string, maxBytes: number) {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') > maxBytes) {
    throw new ExternalProviderError('invalid_output', 'A saída estruturada do yt-dlp excedeu o limite permitido.');
  }
  return next;
}

function terminateProcessGroup(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const force = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, TERMINATION_GRACE_MS);
  force.unref?.();
  child.once('exit', () => clearTimeout(force));
}

export const runYtDlpProcess: YtDlpProcessRunner = request => new Promise((resolve, reject) => {
  if (request.signal.aborted) {
    reject(request.signal.reason instanceof Error ? request.signal.reason : new ExternalProviderError('provider_cancelled', 'Importação do provider cancelada.', 409));
    return;
  }

  const child = spawn(request.launcherPath, [request.commandPath, ...request.args], {
    cwd: request.cwd,
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: request.cwd,
      TMPDIR: request.cwd,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8'
    }
  });

  let stdout = '';
  let stderr = '';
  let settled = false;
  const settle = (operation: () => void) => {
    if (settled) return;
    settled = true;
    request.signal.removeEventListener('abort', onAbort);
    operation();
  };
  const fail = (error: unknown) => {
    terminateProcessGroup(child);
    settle(() => reject(error));
  };
  const onAbort = () => fail(request.signal.reason instanceof Error
    ? request.signal.reason
    : new ExternalProviderError('provider_cancelled', 'Importação do provider cancelada.', 409));

  request.signal.addEventListener('abort', onAbort, { once: true });
  child.stdout?.on('data', chunk => {
    try { stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES); } catch (error) { fail(error); }
  });
  child.stderr?.on('data', chunk => {
    try { stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES); } catch (error) { fail(error); }
  });
  child.once('error', () => settle(() => reject(new ExternalProviderError('provider_failed', 'Não foi possível iniciar o yt-dlp.', 502))));
  child.once('close', code => {
    if (settled) return;
    if (code !== 0) {
      settle(() => reject(new ExternalProviderError('provider_failed', 'O yt-dlp não conseguiu adquirir a mídia.', 502)));
      return;
    }
    settle(() => resolve({ stdout, stderr }));
  });
});

export class YtDlpProvider implements ExternalProvider {
  readonly id = YT_DLP_PROVIDER_ID;
  readonly label = 'yt-dlp';
  readonly capabilities = Object.freeze({
    audio: true,
    metadata: true,
    thumbnail: true,
    playlists: false
  });
  readonly requiredConfigKeys = Object.freeze([
    YT_DLP_COMMAND_CONFIG,
    YT_DLP_EGRESS_LAUNCHER_CONFIG
  ]);

  constructor(private readonly runner: YtDlpProcessRunner = runYtDlpProcess) {}

  validate(request: ExternalProviderRequest) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new ExternalProviderError('invalid_input', 'URL externa inválida.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ExternalProviderError('invalid_input', 'Somente URLs HTTP e HTTPS são aceitas pelo yt-dlp.');
    }
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
      throw new ExternalProviderError('invalid_input', 'Hosts locais não são aceitos pelo provider externo.');
    }
    if (url.username || url.password) {
      throw new ExternalProviderError('invalid_input', 'URLs com credenciais embutidas não são aceitas pelo provider externo.');
    }
  }

  async prepare(request: ExternalProviderRequest, context: ExternalProviderContext): Promise<ExternalProviderPreparedMedia> {
    const commandPath = requireAbsoluteExecutable(context.config[YT_DLP_COMMAND_CONFIG], 'yt-dlp');
    const launcherPath = requireAbsoluteExecutable(context.config[YT_DLP_EGRESS_LAUNCHER_CONFIG], 'Launcher de egress');
    const result = await this.runner({
      launcherPath,
      commandPath,
      args: fixedArguments(request, context.scratchDir),
      cwd: context.scratchDir,
      signal: context.signal
    });
    const metadata = parseMetadata(result.stdout);
    const relativePath = await findPreparedOutput(context.scratchDir);
    return {
      relativePath,
      metadata: {
        sourceId: cleanString(metadata.id),
        title: cleanString(metadata.title),
        artist: cleanString(metadata.artist) || cleanString(metadata.creator) || cleanString(metadata.uploader),
        album: cleanString(metadata.album),
        thumbnailUrl: cleanThumbnail(metadata)
      }
    };
  }
}
