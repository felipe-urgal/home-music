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
import { ExternalProviderEgressProxy } from './external-provider-egress-proxy.js';
import { isUnsafeImportAddress } from './import-url.js';
import { selectBestProviderAudioCandidate, type ImportAudioCandidate } from './import-media-validation.js';

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_COMMAND_LENGTH = 1024;
const TERMINATION_GRACE_MS = 1500;
const OUTPUT_PREFIX = 'home-music-media.';
const SAFE_CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm'
};
const LOSSLESS_CODECS = new Set(['alac', 'ape', 'flac', 'wavpack']);

export const YT_DLP_PROVIDER_ID = 'yt-dlp';
export const YT_DLP_COMMAND_CONFIG = 'command';

type YtDlpFormat = {
  format_id?: unknown;
  acodec?: unknown;
  vcodec?: unknown;
  ext?: unknown;
  abr?: unknown;
  tbr?: unknown;
  asr?: unknown;
  audio_channels?: unknown;
};

type YtDlpMetadata = {
  _type?: unknown;
  id?: unknown;
  title?: unknown;
  track?: unknown;
  artist?: unknown;
  creator?: unknown;
  uploader?: unknown;
  channel?: unknown;
  album?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
  formats?: unknown;
};

export type YtDlpProcessRequest = Readonly<{
  commandPath: string;
  args: readonly string[];
  cwd: string;
  proxyUrl: string;
  signal: AbortSignal;
}>;

export type YtDlpProcessResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export type YtDlpProcessRunner = (request: YtDlpProcessRequest) => Promise<YtDlpProcessResult>;

type ProviderProxy = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

type YtDlpProviderOptions = {
  runner?: YtDlpProcessRunner;
  createProxy?: () => Promise<ProviderProxy>;
};

export type YtDlpAudioCandidate = ImportAudioCandidate & Readonly<{
  extension: string | null;
}>;

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, 500) : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanThumbnail(metadata: YtDlpMetadata) {
  const values: unknown[] = [metadata.thumbnail];
  if (Array.isArray(metadata.thumbnails)) {
    for (let index = metadata.thumbnails.length - 1; index >= 0; index -= 1) {
      const item = metadata.thumbnails[index];
      if (item && typeof item === 'object') values.push((item as { url?: unknown }).url);
    }
  }
  for (const value of values) {
    const raw = cleanString(value);
    if (!raw || raw.length > 2048) continue;
    try {
      const url = new URL(raw);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) {
        return url.toString();
      }
    } catch {
      // Sugestão inválida é ignorada; o core nunca busca a thumbnail diretamente.
    }
  }
  return null;
}

function parseMetadata(stdout: string): YtDlpMetadata {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou metadata estruturada.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou metadata inválida.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou metadata inválida.');
  }
  const metadata = parsed as YtDlpMetadata;
  if (metadata._type === 'playlist') {
    throw new ExternalProviderError('invalid_input', 'Playlists não são suportadas pelo provider externo.');
  }
  return metadata;
}

function requireAbsoluteExecutable(value: string | undefined) {
  const clean = value?.trim() ?? '';
  if (!clean || clean.length > MAX_COMMAND_LENGTH || !path.isAbsolute(clean) || clean.includes('\u0000')) {
    throw new ExternalProviderError('provider_not_configured', 'O executável do yt-dlp não está configurado.', 503);
  }
  return path.normalize(clean);
}

function literalHost(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export function ytDlpAudioCandidates(info: YtDlpMetadata): YtDlpAudioCandidate[] {
  if (!Array.isArray(info.formats)) return [];
  const candidates: YtDlpAudioCandidate[] = [];
  for (const raw of info.formats as YtDlpFormat[]) {
    const id = cleanString(raw.format_id);
    const codec = cleanString(raw.acodec)?.toLowerCase() ?? null;
    if (!id || !codec || codec === 'none') continue;
    const extension = cleanString(raw.ext)?.toLowerCase() ?? null;
    const bitRateKbps = numberValue(raw.abr) ?? numberValue(raw.tbr);
    candidates.push({
      id,
      codec,
      container: extension,
      extension,
      bitRate: bitRateKbps == null ? null : bitRateKbps * 1000,
      sampleRate: numberValue(raw.asr),
      channels: numberValue(raw.audio_channels),
      audioOnly: cleanString(raw.vcodec)?.toLowerCase() === 'none',
      lossless: LOSSLESS_CODECS.has(codec) || codec.startsWith('pcm_')
    });
  }
  return candidates;
}

export function selectYtDlpAudioFormat(info: YtDlpMetadata) {
  const selected = selectBestProviderAudioCandidate(ytDlpAudioCandidates(info));
  if (!selected || selected.audioOnly === false) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp não encontrou uma fonte de áudio utilizável.');
  }
  return selected;
}

async function defaultCreateProxy(): Promise<ProviderProxy> {
  const proxy = new ExternalProviderEgressProxy();
  const url = await proxy.start();
  return { url, close: () => proxy.close() };
}

function commonArguments(proxyUrl: string) {
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-geo-bypass',
    '--no-playlist',
    '--playlist-end', '1',
    '--no-colors',
    '--no-warnings',
    '--js-runtimes', `node:${process.execPath}`,
    '--proxy', proxyUrl
  ];
}

function appendBounded(current: string, chunk: Buffer | string, maxBytes: number) {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next, 'utf8') > maxBytes) {
    throw new ExternalProviderError('invalid_output', 'A saída do yt-dlp excedeu o limite permitido.');
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
    reject(request.signal.reason instanceof Error
      ? request.signal.reason
      : new ExternalProviderError('provider_cancelled', 'Importação do provider cancelada.', 409));
    return;
  }

  const child = spawn(request.commandPath, [...request.args], {
    cwd: request.cwd,
    shell: false,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: request.cwd,
      TMPDIR: request.cwd,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      HTTP_PROXY: request.proxyUrl,
      HTTPS_PROXY: request.proxyUrl,
      ALL_PROXY: request.proxyUrl,
      NO_PROXY: '',
      YTDLP_NO_PLUGINS: '1'
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
    try {
      stdout = appendBounded(stdout, chunk, MAX_STDOUT_BYTES);
    } catch (error) {
      fail(error);
    }
  });
  child.stderr?.on('data', chunk => {
    try {
      stderr = appendBounded(stderr, chunk, MAX_STDERR_BYTES);
    } catch (error) {
      fail(error);
    }
  });
  child.once('error', () => settle(() => reject(
    new ExternalProviderError('provider_failed', 'Não foi possível iniciar o yt-dlp.', 502)
  )));
  child.once('close', code => {
    if (settled) return;
    if (code !== 0) {
      settle(() => reject(new ExternalProviderError('provider_failed', 'O yt-dlp não conseguiu adquirir a mídia.', 502)));
      return;
    }
    settle(() => resolve({ stdout: stdout.trim(), stderr }));
  });
});

async function findPreparedOutput(scratchDir: string) {
  const entries = await readdir(scratchDir, { withFileTypes: true });
  const candidates = entries
    .filter(entry => entry.isFile() && entry.name.startsWith(OUTPUT_PREFIX))
    .filter(entry => !entry.name.endsWith('.part') && !entry.name.endsWith('.ytdl'));
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

function providerMetadata(info: YtDlpMetadata) {
  return {
    sourceId: cleanString(info.id),
    title: cleanString(info.track) ?? cleanString(info.title),
    artist: cleanString(info.artist) ?? cleanString(info.creator),
    album: cleanString(info.album),
    thumbnailUrl: cleanThumbnail(info)
  };
}

export class YtDlpProvider implements ExternalProvider {
  readonly id = YT_DLP_PROVIDER_ID;
  readonly label = 'yt-dlp · YouTube Music e sites compatíveis';
  readonly capabilities = Object.freeze({
    audio: true,
    metadata: true,
    thumbnail: true,
    playlists: false
  });
  readonly requiredConfigKeys = Object.freeze([YT_DLP_COMMAND_CONFIG]);

  private readonly runner: YtDlpProcessRunner;
  private readonly createProxy: () => Promise<ProviderProxy>;

  constructor(options: YtDlpProviderOptions | YtDlpProcessRunner = {}) {
    if (typeof options === 'function') {
      this.runner = options;
      this.createProxy = defaultCreateProxy;
      return;
    }
    this.runner = options.runner ?? runYtDlpProcess;
    this.createProxy = options.createProxy ?? defaultCreateProxy;
  }

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
    if (url.username || url.password) {
      throw new ExternalProviderError('invalid_input', 'URLs com credenciais embutidas não são aceitas pelo provider externo.');
    }
    const hostname = literalHost(url.hostname).toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
      throw new ExternalProviderError('invalid_input', 'Hosts locais não são aceitos pelo provider externo.');
    }
    if ((hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)) && isUnsafeImportAddress(hostname)) {
      throw new ExternalProviderError('invalid_input', 'A URL externa aponta para uma rede não permitida.');
    }
  }

  async prepare(request: ExternalProviderRequest, context: ExternalProviderContext): Promise<ExternalProviderPreparedMedia> {
    const commandPath = requireAbsoluteExecutable(context.config[YT_DLP_COMMAND_CONFIG]);
    const proxy = await this.createProxy();
    try {
      const common = commonArguments(proxy.url);
      const infoResult = await this.runner({
        commandPath,
        args: [
          ...common,
          '--dump-single-json',
          '--skip-download',
          '--', request.url
        ],
        cwd: context.scratchDir,
        proxyUrl: proxy.url,
        signal: context.signal
      });
      const info = parseMetadata(infoResult.stdout);
      const selected = selectYtDlpAudioFormat(info);

      await this.runner({
        commandPath,
        args: [
          ...common,
          '--format', selected.id,
          '--output', `${OUTPUT_PREFIX}%(ext)s`,
          '--no-progress',
          '--no-overwrites',
          '--', request.url
        ],
        cwd: context.scratchDir,
        proxyUrl: proxy.url,
        signal: context.signal
      });

      const relativePath = await findPreparedOutput(context.scratchDir);
      const extension = path.extname(relativePath).slice(1).toLowerCase();
      return {
        relativePath,
        contentType: SAFE_CONTENT_TYPES[extension] ?? null,
        metadata: providerMetadata(info)
      };
    } finally {
      await proxy.close().catch(() => undefined);
    }
  }
}