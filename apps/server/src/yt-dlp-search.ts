import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AdminExternalProviderSearchItem,
  AdminExternalProviderSearchResponse
} from '@home-music/shared';
import { ExternalProviderError } from './external-provider.js';
import { ExternalProviderEgressProxy } from './external-provider-egress-proxy.js';
import {
  runYtDlpProcess,
  YT_DLP_PROVIDER_ID,
  type YtDlpProcessRunner
} from './yt-dlp-provider.js';

const MAX_COMMAND_LENGTH = 1_024;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_RESULTS = 10;
const MAX_RESULTS = 20;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;

type YtDlpSearchEntry = {
  id?: unknown;
  title?: unknown;
  track?: unknown;
  artist?: unknown;
  creator?: unknown;
  uploader?: unknown;
  channel?: unknown;
  duration?: unknown;
  thumbnail?: unknown;
  thumbnails?: unknown;
};

type YtDlpSearchInfo = {
  _type?: unknown;
  entries?: unknown;
};

type ProviderProxy = Readonly<{
  url: string;
  close: () => Promise<void>;
}>;

export type YtDlpSearchOptions = {
  commandPath: string;
  maxResults?: number;
  runner?: YtDlpProcessRunner;
  createProxy?: () => Promise<ProviderProxy>;
};

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

export function normalizeYtDlpSearchQuery(value: unknown) {
  const clean = cleanText(value, MAX_QUERY_LENGTH);
  if (!clean || clean.length < 2) {
    throw new ExternalProviderError('invalid_input', 'Digite pelo menos 2 caracteres para buscar.', 400);
  }
  return clean;
}

function commandPath(value: string) {
  const clean = value.trim();
  if (!clean || clean.length > MAX_COMMAND_LENGTH || !path.isAbsolute(clean) || clean.includes('\0')) {
    throw new ExternalProviderError('provider_not_configured', 'O executável do yt-dlp não está configurado.', 503);
  }
  return path.normalize(clean);
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeThumbnailUrl(value: unknown) {
  const raw = cleanText(value, 2_048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const allowed = host === 'ytimg.com'
      || host.endsWith('.ytimg.com')
      || host === 'ggpht.com'
      || host.endsWith('.ggpht.com')
      || host === 'googleusercontent.com'
      || host.endsWith('.googleusercontent.com');
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

function thumbnail(entry: YtDlpSearchEntry) {
  const direct = safeThumbnailUrl(entry.thumbnail);
  if (direct) return direct;
  if (!Array.isArray(entry.thumbnails)) return null;
  for (let index = entry.thumbnails.length - 1; index >= 0; index -= 1) {
    const item = entry.thumbnails[index];
    if (!item || typeof item !== 'object') continue;
    const url = safeThumbnailUrl((item as { url?: unknown }).url);
    if (url) return url;
  }
  return null;
}

function parseSearch(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou resultados de busca.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou uma busca inválida.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp retornou uma busca inválida.');
  }
  const info = parsed as YtDlpSearchInfo;
  if (info._type !== 'playlist' || !Array.isArray(info.entries)) {
    throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou uma lista de resultados válida.');
  }
  return info.entries as YtDlpSearchEntry[];
}

function normalizeEntry(entry: YtDlpSearchEntry): AdminExternalProviderSearchItem | null {
  const id = cleanText(entry.id, 128);
  if (!id || !YOUTUBE_VIDEO_ID.test(id)) return null;
  const title = cleanText(entry.track, 300) ?? cleanText(entry.title, 300);
  if (!title) return null;
  const artist = cleanText(entry.artist, 240)
    ?? cleanText(entry.uploader, 240)
    ?? cleanText(entry.channel, 240)
    ?? cleanText(entry.creator, 240);
  return {
    id,
    title,
    artist,
    durationSeconds: numberValue(entry.duration),
    thumbnailUrl: thumbnail(entry),
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    provider: YT_DLP_PROVIDER_ID
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

export class YtDlpSearch {
  readonly providerId = YT_DLP_PROVIDER_ID;
  private readonly command: string;
  private readonly maxResults: number;
  private readonly runner: YtDlpProcessRunner;
  private readonly createProxy: () => Promise<ProviderProxy>;

  constructor(options: YtDlpSearchOptions) {
    this.command = commandPath(options.commandPath);
    const limit = options.maxResults ?? DEFAULT_RESULTS;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_RESULTS) {
      throw new Error('Limite de resultados do yt-dlp inválido.');
    }
    this.maxResults = limit;
    this.runner = options.runner ?? runYtDlpProcess;
    this.createProxy = options.createProxy ?? defaultCreateProxy;
  }

  async search(value: unknown, signal: AbortSignal): Promise<AdminExternalProviderSearchResponse> {
    const query = normalizeYtDlpSearchQuery(value);
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'home-music-ytdlp-search-'));
    let proxy: ProviderProxy | null = null;
    try {
      proxy = await this.createProxy();
      const result = await this.runner({
        commandPath: this.command,
        args: [
          ...commonArguments(proxy.url),
          '--flat-playlist',
          '--dump-single-json',
          '--skip-download',
          '--playlist-end', String(this.maxResults),
          '--', `ytsearch${this.maxResults}:${query}`
        ],
        cwd: workspace,
        proxyUrl: proxy.url,
        signal
      });
      const entries = parseSearch(result.stdout);
      const items: AdminExternalProviderSearchItem[] = [];
      const seen = new Set<string>();
      for (const entry of entries) {
        const item = normalizeEntry(entry);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        if (items.length >= this.maxResults) break;
      }
      return { query, items };
    } finally {
      await proxy?.close().catch(() => undefined);
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
