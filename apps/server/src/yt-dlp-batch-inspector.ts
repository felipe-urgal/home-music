import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
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
import { SpotifyEmbedCatalog, type SpotifyCatalogTrack } from './spotify-embed-catalog.js';
import { selectSpotifyMediaMatch } from './spotify-media-match.js';
import {
  runYtDlpProcess,
  YT_DLP_PROVIDER_ID,
  type YtDlpProcessRunner
} from './yt-dlp-provider.js';
import { YtDlpSearch } from './yt-dlp-search.js';

const MAX_COMMAND_LENGTH = 1_024;
const MAX_ITEM_LABEL_LENGTH = 240;
const MAX_PLAYLIST_LABEL_LENGTH = 240;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;
const SPOTIFY_MATCH_CONCURRENCY = 3;
const SPOTIFY_SEARCH_RESULTS = 8;

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
  spotifyCatalog?: Pick<SpotifyEmbedCatalog, 'inspect'>;
  search?: Pick<YtDlpSearch, 'search'>;
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
  const youtubeHost = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  const explicitPlaylist = url.pathname === '/playlist' && Boolean(url.searchParams.get('list'));
  if (!youtubeHost || !explicitPlaylist) return null;
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

function safeItem(entry: YtDlpPlaylistEntry, index: number, musicOrigin: boolean): ExternalProviderBatchInspectionItem {
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
  const host = musicOrigin ? 'music.youtube.com' : 'www.youtube.com';
  return {
    sourceId,
    label,
    durationSeconds: durationSeconds(entry.duration),
    request: { url: `https://${host}/watch?v=${encodeURIComponent(sourceId)}` },
    unavailableReason: null
  };
}

function spotifyLabel(track: SpotifyCatalogTrack) {
  return cleanText(`${track.artist} — ${track.title}`, MAX_ITEM_LABEL_LENGTH) ?? track.title;
}

function spotifyUnavailable(
  track: SpotifyCatalogTrack,
  reason: string
): ExternalProviderBatchInspectionItem {
  return {
    sourceId: track.id,
    label: spotifyLabel(track),
    durationSeconds: track.durationSeconds,
    request: null,
    unavailableReason: reason
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class YtDlpBatchInspector implements ExternalProviderBatchInspector {
  readonly providerId = YT_DLP_PROVIDER_ID;
  private readonly command: string;
  private readonly maxItems: number;
  private readonly runner: YtDlpProcessRunner;
  private readonly createProxy: () => Promise<ProviderProxy>;
  private readonly spotifyCatalog: Pick<SpotifyEmbedCatalog, 'inspect'>;
  private readonly search: Pick<YtDlpSearch, 'search'>;

  constructor(options: YtDlpBatchInspectorOptions) {
    this.command = commandPath(options.commandPath);
    if (!Number.isSafeInteger(options.maxItems) || options.maxItems <= 0 || options.maxItems > 1_000) {
      throw new Error('Limite de itens do inspector yt-dlp inválido.');
    }
    this.maxItems = options.maxItems;
    this.runner = options.runner ?? runYtDlpProcess;
    this.createProxy = options.createProxy ?? defaultCreateProxy;
    this.spotifyCatalog = options.spotifyCatalog ?? new SpotifyEmbedCatalog();
    this.search = options.search ?? new YtDlpSearch({
      commandPath: this.command,
      maxResults: SPOTIFY_SEARCH_RESULTS,
      runner: this.runner,
      createProxy: this.createProxy
    });
  }

  async inspect(request: ExternalProviderRequest, signal: AbortSignal): Promise<ExternalProviderBatchInspection | null> {
    const spotify = await this.spotifyCatalog.inspect(request, signal);
    if (spotify) return this.inspectSpotify(spotify, signal);

    const target = playlistUrl(request.url);
    if (!target) return null;

    const workspace = await mkdtemp(path.join(os.tmpdir(), 'home-music-ytdlp-inspect-'));
    let proxy: ProviderProxy | null = null;
    try {
      proxy = await this.createProxy();
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
        cwd: workspace,
        proxyUrl: proxy.url,
        signal
      });
      const info = parsePlaylist(result.stdout);
      if (info._type !== 'playlist') return null;
      if (!Array.isArray(info.entries)) {
        throw new ExternalProviderError('invalid_output', 'O yt-dlp não retornou itens válidos da playlist.');
      }

      const musicOrigin = new URL(target).hostname.toLowerCase() === 'music.youtube.com';
      const items = (info.entries as YtDlpPlaylistEntry[]).map((entry, index) => safeItem(entry, index, musicOrigin));
      return {
        providerId: this.providerId,
        label: cleanText(info.title, MAX_PLAYLIST_LABEL_LENGTH) ?? 'Playlist do YouTube',
        items
      };
    } finally {
      await proxy?.close().catch(() => undefined);
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async inspectSpotify(
    spotify: NonNullable<Awaited<ReturnType<SpotifyEmbedCatalog['inspect']>>>,
    signal: AbortSignal
  ): Promise<ExternalProviderBatchInspection> {
    // Deixe o manager canônico produzir o erro de limite sem disparar buscas externas desnecessárias.
    if (spotify.tracks.length > this.maxItems) {
      return {
        providerId: this.providerId,
        label: `Spotify · ${spotify.label}`,
        items: spotify.tracks.map(track => spotifyUnavailable(
          track,
          `A coleção excede o limite de ${this.maxItems} itens por lote.`
        ))
      };
    }

    const items = await mapWithConcurrency(
      spotify.tracks,
      SPOTIFY_MATCH_CONCURRENCY,
      async track => {
        if (signal.aborted) {
          return spotifyUnavailable(track, 'Resolução cancelada.');
        }
        try {
          const response = await this.search.search(`${track.artist} ${track.title}`, signal);
          const match = selectSpotifyMediaMatch(track, response.items);
          if (!match) {
            return spotifyUnavailable(track, 'Nenhum candidato de mídia foi encontrado.');
          }
          if (!match.automatic) {
            const confidence = Math.round(match.confidence * 100);
            return spotifyUnavailable(
              track,
              `Correspondência ambígua (${confidence}% de confiança). Busque esta faixa manualmente para revisar a origem.`
            );
          }

          return {
            sourceId: track.id,
            label: spotifyLabel(track),
            durationSeconds: track.durationSeconds,
            request: {
              url: match.item.sourceUrl,
              metadata: {
                title: track.title,
                artist: track.artist,
                album: track.album,
                thumbnailUrl: track.thumbnailUrl,
                attribution: `Spotify · catálogo · match ${Math.round(match.confidence * 100)}%`
              }
            },
            unavailableReason: null
          } satisfies ExternalProviderBatchInspectionItem;
        } catch (error) {
          if (signal.aborted) return spotifyUnavailable(track, 'Resolução cancelada.');
          const message = error instanceof ExternalProviderError
            ? error.message
            : 'Não foi possível buscar candidatos para esta faixa.';
          return spotifyUnavailable(track, message);
        }
      }
    );

    return {
      providerId: this.providerId,
      label: `Spotify · ${spotify.label}`,
      items
    };
  }
}
