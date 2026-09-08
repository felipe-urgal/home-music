type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MUSICBRAINZ_ORIGIN = 'https://musicbrainz.org';
const MUSICBRAINZ_RECORDING_PATH = '/ws/2/recording';
const RELEASE_FILTER = /\s+AND\s+release:"(?:\\.|[^"\\])*"/gi;
const MAX_RETRY_AFTER_MS = 2 * 60 * 60 * 1_000;

type MusicBrainzRetryableCode = 'provider-rate-limited' | 'provider-unavailable';

export class MusicBrainzRetryableRequestError extends Error {
  constructor(
    public readonly code: MusicBrainzRetryableCode,
    public readonly statusCode: 429 | 503,
    public readonly retryAfterMs: number | null
  ) {
    super(statusCode === 429
      ? 'MusicBrainz solicitou uma pausa antes de novas consultas.'
      : 'MusicBrainz está temporariamente indisponível.');
    this.name = 'MusicBrainzRetryableRequestError';
  }
}

function simplifiedMusicBrainzUrl(input: string | URL) {
  const url = new URL(String(input));
  if (url.origin !== MUSICBRAINZ_ORIGIN || url.pathname !== MUSICBRAINZ_RECORDING_PATH) return url;

  const query = url.searchParams.get('query');
  if (!query || !/\brelease:/i.test(query)) return url;

  const simplified = query.replace(RELEASE_FILTER, '').trim();
  if (simplified) url.searchParams.set('query', simplified);
  return url;
}

function isMusicBrainzRecordingUrl(url: URL) {
  return url.origin === MUSICBRAINZ_ORIGIN && url.pathname === MUSICBRAINZ_RECORDING_PATH;
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()) {
  const clean = value?.trim();
  if (!clean) return null;

  if (/^\d+$/.test(clean)) {
    const seconds = Number(clean);
    if (!Number.isSafeInteger(seconds)) return null;
    return Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000);
  }

  const retryAtMs = Date.parse(clean);
  if (!Number.isFinite(retryAtMs) || !Number.isFinite(nowMs)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.round(retryAtMs - nowMs)));
}

export function createMusicBrainzSimpleSearchFetch(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  now: () => number = Date.now
): FetchLike {
  return async (input, init) => {
    const url = simplifiedMusicBrainzUrl(input);
    const response = await fetchImpl(url, init);
    if (!isMusicBrainzRecordingUrl(url)) return response;

    if (response.status === 429 || response.status === 503) {
      throw new MusicBrainzRetryableRequestError(
        response.status === 429 ? 'provider-rate-limited' : 'provider-unavailable',
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after'), now())
      );
    }
    return response;
  };
}
