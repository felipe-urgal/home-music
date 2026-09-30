import https from 'node:https';
import {
  ExternalProviderError,
  type ExternalProviderRequest
} from './external-provider.js';
import { resolveSafeProviderTarget } from './external-provider-egress-proxy.js';

const SPOTIFY_HOST = 'open.spotify.com';
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const NEXT_DATA = /<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

export type SpotifyCatalogType = 'track' | 'album' | 'playlist';

export type SpotifyCatalogTrack = Readonly<{
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  spotifyUrl: string;
}>;

export type SpotifyCatalogInspection = Readonly<{
  type: SpotifyCatalogType;
  id: string;
  label: string;
  owner: string | null;
  thumbnailUrl: string | null;
  spotifyUrl: string;
  tracks: readonly SpotifyCatalogTrack[];
}>;

export type ParsedSpotifyCatalogUrl = Readonly<{
  type: SpotifyCatalogType;
  id: string;
  canonicalUrl: string;
  embedUrl: string;
}>;

type SpotifyEmbedFetch = (url: URL, signal: AbortSignal) => Promise<string>;

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findProperty(root: unknown, property: string) {
  const queue: unknown[] = [root];
  const seen = new Set<object>();
  let visited = 0;
  while (queue.length > 0 && visited < 20_000) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current as object)) continue;
    seen.add(current as object);
    visited += 1;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (Object.hasOwn(record, property)) return record[property];
    queue.push(...Object.values(record));
  }
  return undefined;
}

function spotifyIdFromUri(value: unknown) {
  const text = cleanText(value, 128);
  const match = text?.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  return match?.[1] ?? null;
}

function artistsFromValue(value: unknown) {
  if (!Array.isArray(value)) return null;
  const names = value
    .map(item => cleanText(asRecord(item)?.name, 160))
    .filter((item): item is string => Boolean(item));
  return names.length > 0 ? names.join(', ') : null;
}

function durationFromEmbed(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 10_000 ? parsed / 1000 : parsed;
}

function firstImageUrl(value: unknown) {
  const record = asRecord(value);
  const coverArt = asRecord(record?.coverArt);
  const sources = Array.isArray(coverArt?.sources) ? coverArt.sources : [];
  for (const item of sources) {
    const url = cleanText(asRecord(item)?.url, 2_048);
    if (url?.startsWith('https://')) return url;
  }

  const visual = asRecord(record?.visualIdentity);
  const image = asRecord(visual?.image);
  const visualSources = Array.isArray(image?.sources) ? image.sources : [];
  for (const item of visualSources) {
    const url = cleanText(asRecord(item)?.url, 2_048);
    if (url?.startsWith('https://')) return url;
  }
  return null;
}

function normalizeTrack(
  raw: unknown,
  fallbackAlbum: string | null,
  fallbackThumbnail: string | null
): SpotifyCatalogTrack | null {
  const record = asRecord(raw);
  if (!record) return null;

  const id = spotifyIdFromUri(record.uri)
    ?? cleanText(record.id, 64);
  if (!id || !SPOTIFY_ID.test(id)) return null;

  const title = cleanText(record.title, 300)
    ?? cleanText(record.name, 300);
  if (!title) return null;

  const artist = cleanText(record.subtitle, 300)
    ?? artistsFromValue(record.artists)
    ?? 'Artista desconhecido';

  const albumRecord = asRecord(record.album);
  const album = cleanText(albumRecord?.name, 300)
    ?? cleanText(record.albumName, 300)
    ?? fallbackAlbum;

  const durationSeconds = durationFromEmbed(record.duration)
    ?? durationFromEmbed(record.durationMs)
    ?? durationFromEmbed(record.duration_ms);

  return {
    id,
    title,
    artist,
    album,
    durationSeconds,
    thumbnailUrl: firstImageUrl(record) ?? fallbackThumbnail,
    spotifyUrl: `https://open.spotify.com/track/${id}`
  };
}

function entityFromNextData(value: unknown) {
  const direct = asRecord(findProperty(value, 'entity'));
  if (direct) return direct;
  throw new ExternalProviderError(
    'invalid_output',
    'O Spotify não retornou metadata utilizável para este link.'
  );
}

export function parseSpotifyCatalogUrl(value: string): ParsedSpotifyCatalogUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.toLowerCase() !== SPOTIFY_HOST) {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0]?.toLowerCase().startsWith('intl-')) segments.shift();
  const rawType = segments[0]?.toLowerCase();
  const id = segments[1] ?? '';
  if (rawType !== 'track' && rawType !== 'album' && rawType !== 'playlist') {
    throw new ExternalProviderError(
      'invalid_input',
      'Use um link do Spotify para faixa, álbum ou playlist.'
    );
  }
  if (!SPOTIFY_ID.test(id)) {
    throw new ExternalProviderError('invalid_input', 'O link do Spotify possui um identificador inválido.');
  }

  const type = rawType as SpotifyCatalogType;
  const canonicalUrl = `https://open.spotify.com/${type}/${id}`;
  return {
    type,
    id,
    canonicalUrl,
    embedUrl: `https://open.spotify.com/embed/${type}/${id}`
  };
}

export function parseSpotifyEmbedDocument(
  html: string,
  source: ParsedSpotifyCatalogUrl
): SpotifyCatalogInspection {
  if (!html || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new ExternalProviderError('invalid_output', 'A resposta do Spotify é inválida ou excede o limite.');
  }
  const match = html.match(NEXT_DATA);
  if (!match?.[1]) {
    throw new ExternalProviderError(
      'invalid_output',
      'O Spotify não retornou a lista de faixas esperada.'
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new ExternalProviderError('invalid_output', 'O Spotify retornou metadata inválida.');
  }

  const entity = entityFromNextData(data);
  const collectionLabel = cleanText(entity.name, 300)
    ?? cleanText(entity.title, 300)
    ?? (source.type === 'track' ? 'Faixa do Spotify' : source.type === 'album' ? 'Álbum do Spotify' : 'Playlist do Spotify');
  const owner = cleanText(entity.subtitle, 300);
  const thumbnailUrl = firstImageUrl(entity);
  const fallbackAlbum = source.type === 'album' ? collectionLabel : null;

  const rawTrackList = findProperty(entity, 'trackList');
  const rawTracks = Array.isArray(rawTrackList)
    ? rawTrackList
    : source.type === 'track'
      ? [entity]
      : [];

  const tracks = rawTracks
    .map(item => normalizeTrack(item, fallbackAlbum, thumbnailUrl))
    .filter((item): item is SpotifyCatalogTrack => Boolean(item));

  if (tracks.length === 0) {
    throw new ExternalProviderError(
      'invalid_output',
      'O Spotify não expôs faixas importáveis para este link.'
    );
  }

  return {
    type: source.type,
    id: source.id,
    label: collectionLabel,
    owner,
    thumbnailUrl,
    spotifyUrl: source.canonicalUrl,
    tracks
  };
}

async function defaultFetchEmbed(url: URL, signal: AbortSignal) {
  const resolved = await resolveSafeProviderTarget(url.hostname);
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }

    const request = https.request({
      protocol: 'https:',
      hostname: resolved.address,
      family: resolved.family,
      port: 443,
      servername: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Host: url.hostname,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'identity',
        'User-Agent': 'Home-Music/spotify-catalog'
      }
    });

    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      operation();
    };
    const fail = (error: Error) => finish(() => {
      request.destroy();
      reject(error);
    });
    const onAbort = () => fail(signal.reason instanceof Error
      ? signal.reason
      : new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      fail(new ExternalProviderError('provider_timeout', 'A consulta ao Spotify excedeu o tempo limite.', 504));
    }, REQUEST_TIMEOUT_MS);
    timeout.unref?.();

    request.once('error', () => fail(new ExternalProviderError(
      'provider_network_failed',
      'Não foi possível consultar o catálogo público do Spotify.',
      502
    )));

    request.once('response', response => {
      if (response.statusCode !== 200) {
        response.resume();
        const status = response.statusCode ?? 502;
        fail(new ExternalProviderError(
          status === 404 ? 'invalid_input' : 'provider_network_failed',
          status === 404
            ? 'O conteúdo do Spotify não foi encontrado ou não está disponível publicamente.'
            : 'O Spotify não respondeu com um catálogo utilizável.',
          status === 404 ? 404 : 502
        ));
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', chunk => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > MAX_HTML_BYTES) {
          fail(new ExternalProviderError('invalid_output', 'A resposta do Spotify excede o limite permitido.'));
          return;
        }
        chunks.push(buffer);
      });
      response.once('error', () => fail(new ExternalProviderError(
        'provider_network_failed',
        'A resposta do Spotify foi interrompida.',
        502
      )));
      response.once('end', () => finish(() => resolve(Buffer.concat(chunks).toString('utf8'))));
    });

    request.end();
  });
}

export class SpotifyEmbedCatalog {
  private readonly fetchEmbed: SpotifyEmbedFetch;

  constructor(options: { fetchEmbed?: SpotifyEmbedFetch } = {}) {
    this.fetchEmbed = options.fetchEmbed ?? defaultFetchEmbed;
  }

  async inspect(request: ExternalProviderRequest | string, signal: AbortSignal) {
    const value = typeof request === 'string' ? request : request.url;
    const source = parseSpotifyCatalogUrl(value);
    if (!source) return null;
    const html = await this.fetchEmbed(new URL(source.embedUrl), signal);
    return parseSpotifyEmbedDocument(html, source);
  }
}
