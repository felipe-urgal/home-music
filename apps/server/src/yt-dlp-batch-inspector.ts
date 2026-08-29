import path from 'node:path';
import {
  ExternalProviderError,
  type ExternalProviderRequest
} from './external-provider.js';
import { ExternalProviderEgressProxy } from './external-provider-egress-proxy.js';
import type {
  ExternalProviderBatchInspection,
  ExternalProviderBatchInspectionItem,
  ExternalProviderBatchInspector
} from './external-provider-batch.js';
import { isUnsafeImportAddress } from './import-url.js';
import {
  runYtDlpProcess,
  YT_DLP_PROVIDER_ID,
  type YtDlpProcessRunner
} from './yt-dlp-provider.js';

const MAX_COMMAND_LENGTH = 1_024;
const MAX_ITEM_LABEL_LENGTH = 240;
const MAX_PLAYLIST_LABEL_LENGTH = 240;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;

type YtDlpPlaylistEntry = {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
};

type YtDlpPlaylistInfo = {
  _type?: unknown;
  id?: unknown;
  title?: unknown;
  entries?: unknown;
};

type ProviderProxy = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

type YtDlpBatchInspectorOptions = {
  commandPath: string;
  maxItems: number;
  runner?: YtDlpProcessRunner;
  createProxy?: () => Promise<ProviderProxy>;
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function durationSeconds(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function commandPath(value: string) {
  const clean = value.trim();
  if (!clean || clean.length > MAX_COMMAND_LENGTH || !path.isAbsolute(clean) || clean.includes('\0')) {
    throw new ExternalProviderError('provider_not_configured', 'O executável do yt-dlp não está configurado.', 503);
  }
  return path.normalize(clean);
}

function literalHost(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function playlistUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExternalProviderError('invalid_input', 'URL de playlist inválida.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new ExternalProviderError('invalid_input', 'URL de playlist inválida.');
  }

  const hostname = literalHost(url.hostname).toLowerCase();
  const youtubeHost = hostname === 'youtube.com'
    || hostname.endsWith('.youtube.com')
    || hostname === 'youtu.be';
  if (!youtubeHost || !url.searchParams.get('list')) return null;
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || ((hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)) && isUnsafeImportAddress(hostname))
  ) {
    throw new ExternalProviderError('invalid_input', 'A URL externa aponta para uma rede não permitida.');
  }
  url.hash = '';
  return url.toString();
}

function parsePlaylist(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou dados da playlist.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou uma playlist inválida.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou uma playlist inválida.');
  }
  return parsed as YtDlpPlaylistInfo;
}

function safeItem(entry: YtDlpPlaylistEntry, index: number): ExternalProviderBatchInspectionItem {
  const sourceId = cleanText(entry.id, 128);
  const label = cleanText(entry.title, MAX_ITEM_LABEL_LENGTH) ?? `Item ${index + 1}`;
  if (!sourceId || !YOUTUBE_VIDEO_ID.test(sourceId)) {
    return {
      sourceId: null,
      label,
      durationSeconds: durationSeconds(entry.duration),
      request: null,
      unavailableReason: 'Item indisponível ou sem identificador seguro na playlist.'
    };
  }
  return {
    sourceId,
    label,
    durationSeconds: durationSeconds(entry.duration),
    request: { url: `https://www.youtube.com/watch?v=${encodeURIComponent(sourceId)}` },
    unavailableReason: null
  };
}

function commonArguments(proxyUrl: string) {
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-geo-bypass',
    '--no-colors',
    '--no-warnings',
    '--socket-timeout', '10',
    '--retries', '2',
    '--fragment-retries', '2',
    '--extractor-retries', '2',
    '--js-runtimes', `node:${process.execPath}`,
    '--proxy', proxyUrl
  ];
}

async function defaultCreateProxy(): Promise<ProviderProxy> {
  const proxy = new ExternalProviderEgressProxy();
  const url = await proxy.start();
  return { url, close: () => proxy.close() };
}

export class YtDlpBatchInspector implements ExternalProviderBatchInspector {
  readonly providerId = YT_DLP_PROVIDER_ID;
  private readonly command: string;
  private readonly maxItems: number;
  private readonly runner: YtDlpProcessRunner;
  private readonly createProxy: () => Promise<ProviderProxy>;

  constructor(options: YtDlpBatchInspectorOptions) {
    this.command = commandPath(options.commandPath);
    if (!Number.isSafeInteger(options.maxItems) || options.maxItems <= 0 || options.maxItems > 1_000) {
      throw new Error('Limite de itens do inspector yt-dlp inválido.');
    }
    this.maxItems = options.maxItems;
    this.runner = options.runner ?? runYtDlpProcess;
    this.createProxy = options.createProxy ?? defaultCreateProxy;
  }

  async inspect(request: ExternalProviderRequest, signal: AbortSignal): Promise<ExternalProviderBatchInspection | null> {
    const target = playlistUrl(request.url);
    if (!target) return null;

    const proxy = await this.createProxy();
    try {
      const result = await this.runner({
        commandPath: this.command,
        args: [
          ...commonArguments(proxy.url),
          '--yes-playlist',
          '--flat-playlist',
          '--dump-single-json',
          '--skip-download',
          '--playlist-end', String(this.maxItems + 1),
          '--', target
        ],
        cwd: process.cwd(),
        proxyUrl: proxy.url,
        signal
      });
      const info = parsePlaylist(result.stdout);
      if (info._type !== 'playlist') return null;
      if (!Array.isArray(info.entries)) {
        throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou itens válidos da playlist.');
      }

      const items = (info.entries as YtDlpPlaylistEntry[]).map(safeItem);
      return {
        providerId: this.providerId,
        label: cleanText(info.title, MAX_PLAYLIST_LABEL_LENGTH) ?? 'Playlist do YouTube',
        items
      };
    } finally {
      await proxy.close().catch(() => undefined);
    }
  }
}
