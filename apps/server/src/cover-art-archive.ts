import {
  COVER_OVERRIDE_CONTENT_TYPES,
  CoverOverrideValidationError,
  MAX_COVER_OVERRIDE_BYTES
} from './track-cover-overrides.js';
import {
  LibraryAssistantProviderResponseError,
  type LibraryAssistantProviderGateway
} from './library-assistant-provider.js';

export const COVER_ART_ARCHIVE_PROVIDER_VERSION = 'cover-art-archive-release-v1';
const COVER_ART_ARCHIVE_BASE_URL = 'https://coverartarchive.org';
const COVER_ART_ARCHIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const COVER_ART_ARCHIVE_MAX_RESPONSE_CHARS = 512 * 1024;
const COVER_ART_ARCHIVE_MAX_REDIRECTS = 4;
const COVER_ART_ARCHIVE_USER_AGENT = 'HomeMusic/0.1 (+https://github.com/felipe-urgal/home-music)';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type CoverArtArchiveImage = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
};

export type DownloadedCoverArtArchiveImage = {
  data: Buffer;
  contentType: string;
  finalUrl: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeId(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= 96 && /^[A-Za-z0-9-]+$/.test(clean) ? clean : null;
}

function isAllowedArchiveHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'coverartarchive.org'
    || host === 'archive.org'
    || host.endsWith('.archive.org');
}

export function normalizeCoverArtArchiveImageUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!isAllowedArchiveHost(url.hostname)) return null;
    url.protocol = 'https:';
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function bestThumbnail(thumbnails: unknown) {
  const source = record(thumbnails);
  if (!source) return null;
  for (const key of ['1200', 'large', '500', '250', 'small']) {
    const url = normalizeCoverArtArchiveImageUrl(source[key]);
    if (url) return url;
  }
  return null;
}

export function normalizeCoverArtArchiveRelease(payload: unknown): CoverArtArchiveImage | null {
  if (payload === null) return null;
  const root = record(payload);
  if (!root || !Array.isArray(root.images) || root.images.length > 100) {
    throw new LibraryAssistantProviderResponseError();
  }

  for (const rawImage of root.images) {
    const image = record(rawImage);
    if (!image || image.front !== true) continue;
    const imageUrl = normalizeCoverArtArchiveImageUrl(image.image);
    if (!imageUrl) continue;
    const id = typeof image.id === 'string' && image.id.trim().length <= 128
      ? image.id.trim()
      : imageUrl;
    return {
      id,
      imageUrl,
      thumbnailUrl: bestThumbnail(image.thumbnails)
    };
  }

  return null;
}

export async function findCoverArtArchiveFrontCover(options: {
  releaseId: string;
  providers: LibraryAssistantProviderGateway;
  fetchImpl?: FetchLike;
  userAgent?: string;
  signal?: AbortSignal;
}) {
  const releaseId = safeId(options.releaseId);
  if (!releaseId) return null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? COVER_ART_ARCHIVE_USER_AGENT;
  const url = new URL(`/release/${releaseId}`, COVER_ART_ARCHIVE_BASE_URL);

  const result = await options.providers.query({
    provider: { source: 'cover-art-archive', version: COVER_ART_ARCHIVE_PROVIDER_VERSION, userAgent },
    cacheKey: `release:${releaseId}`,
    ttlMs: COVER_ART_ARCHIVE_CACHE_TTL_MS,
    signal: options.signal,
    execute: async ({ signal: providerSignal, userAgent: providerUserAgent }) => {
      const response = await fetchImpl(url, {
        signal: providerSignal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': providerUserAgent
        }
      });
      if (response.status === 404) return { images: [] };
      if (!response.ok) {
        const error = new Error(response.status === 429 || response.status === 503
          ? 'Cover Art Archive temporariamente indisponível. Tente novamente mais tarde.'
          : 'Falha ao consultar Cover Art Archive.');
        Object.assign(error, {
          code: response.status === 429 || response.status === 503
            ? 'provider-rate-limited'
            : 'provider-request-failed',
          statusCode: response.status
        });
        throw error;
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > COVER_ART_ARCHIVE_MAX_RESPONSE_CHARS) {
        throw new LibraryAssistantProviderResponseError();
      }
      const text = await response.text();
      if (text.length > COVER_ART_ARCHIVE_MAX_RESPONSE_CHARS) throw new LibraryAssistantProviderResponseError();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new LibraryAssistantProviderResponseError();
      }
    },
    normalize: normalizeCoverArtArchiveRelease
  });

  return result.value;
}

function normalizeRedirectLocation(base: URL, value: string | null) {
  if (!value) return null;
  try {
    return normalizeCoverArtArchiveImageUrl(new URL(value, base).toString());
  } catch {
    return null;
  }
}

function normalizeDownloadedContentType(value: string | null) {
  return (value ?? '').split(';', 1)[0].trim().toLowerCase();
}

export async function downloadCoverArtArchiveImage(
  sourceUrl: string,
  options: { fetchImpl?: FetchLike; userAgent?: string; signal?: AbortSignal } = {}
): Promise<DownloadedCoverArtArchiveImage> {
  const firstUrl = normalizeCoverArtArchiveImageUrl(sourceUrl);
  if (!firstUrl) {
    throw new CoverOverrideValidationError(400, 'URL de capa do Cover Art Archive inválida.');
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? COVER_ART_ARCHIVE_USER_AGENT;
  let currentUrl = new URL(firstUrl);

  for (let redirect = 0; redirect <= COVER_ART_ARCHIVE_MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(currentUrl, {
      signal: options.signal,
      redirect: 'manual',
      headers: {
        Accept: COVER_OVERRIDE_CONTENT_TYPES.join(', '),
        'User-Agent': userAgent
      }
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const next = normalizeRedirectLocation(currentUrl, response.headers.get('location'));
      if (!next) {
        throw new CoverOverrideValidationError(400, 'Redirect de capa externa não permitido.');
      }
      currentUrl = new URL(next);
      continue;
    }

    if (!response.ok) {
      throw new CoverOverrideValidationError(400, 'Não foi possível baixar a capa externa.');
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_OVERRIDE_BYTES) {
      throw new CoverOverrideValidationError(413, 'A capa deve ter no máximo 8 MiB.');
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > MAX_COVER_OVERRIDE_BYTES) {
      throw new CoverOverrideValidationError(413, 'A capa deve ter no máximo 8 MiB.');
    }

    return {
      data,
      contentType: normalizeDownloadedContentType(response.headers.get('content-type')),
      finalUrl: currentUrl.toString()
    };
  }

  throw new CoverOverrideValidationError(400, 'A capa externa excedeu o limite de redirects.');
}