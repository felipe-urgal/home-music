import {
  LibraryAssistantProviderResponseError,
  type LibraryAssistantProviderGateway
} from './library-assistant-provider.js';

const ACOUSTID_LOOKUP_URL = 'https://api.acoustid.org/v2/lookup';
export const ACOUSTID_PROVIDER_VERSION = 'v2-lookup-recordings-releasegroups';
const ACOUSTID_USER_AGENT = 'HomeMusic/0.1 (+https://github.com/felipe-urgal/home-music)';
const ACOUSTID_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_RESPONSE_CHARS = 512 * 1024;
const MAX_RESULTS = 10;
const MAX_RECORDINGS_PER_RESULT = 10;
const MAX_RELEASE_GROUPS = 8;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AcoustIdFingerprintRecording = {
  recordingId: string;
  title: string | null;
  artist: string | null;
  artistId: string | null;
  releaseGroupId: string | null;
  releaseGroupTitle: string | null;
};

export type AcoustIdFingerprintCandidate = {
  acoustId: string;
  score: number;
  recordings: AcoustIdFingerprintRecording[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= maximum && !/[\r\n\t]/.test(clean) ? clean : null;
}

function artist(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    return { name: null as string | null, id: null as string | null };
  }
  const first = record(value[0]);
  return {
    name: safeText(first?.name),
    id: safeUuid(first?.id)
  };
}

function normalizeRecording(value: unknown): AcoustIdFingerprintRecording | null {
  const item = record(value);
  if (!item) return null;
  const recordingId = safeUuid(item.id);
  if (!recordingId) return null;
  const recordingArtist = artist(item.artists);
  const groups = Array.isArray(item.releasegroups)
    ? item.releasegroups.slice(0, MAX_RELEASE_GROUPS)
    : [];
  const firstGroup = record(groups[0]);
  return {
    recordingId,
    title: safeText(item.title),
    artist: recordingArtist.name,
    artistId: recordingArtist.id,
    releaseGroupId: safeUuid(firstGroup?.id),
    releaseGroupTitle: safeText(firstGroup?.title)
  };
}

export function normalizeAcoustIdFingerprintLookup(payload: unknown): AcoustIdFingerprintCandidate[] {
  const root = record(payload);
  if (!root || root.status !== 'ok' || !Array.isArray(root.results) || root.results.length > MAX_RESULTS) {
    throw new LibraryAssistantProviderResponseError();
  }
  const candidates: AcoustIdFingerprintCandidate[] = [];
  for (const rawResult of root.results) {
    const item = record(rawResult);
    if (!item) continue;
    const acoustId = safeUuid(item.id);
    const score = typeof item.score === 'number' && Number.isFinite(item.score)
      ? Math.max(0, Math.min(1, item.score))
      : null;
    if (!acoustId || score == null) continue;
    const recordings = Array.isArray(item.recordings)
      ? item.recordings.slice(0, MAX_RECORDINGS_PER_RESULT)
        .map(normalizeRecording)
        .filter((value): value is AcoustIdFingerprintRecording => Boolean(value))
      : [];
    if (recordings.length === 0) continue;
    candidates.push({ acoustId, score, recordings });
  }
  return candidates.sort((left, right) => right.score - left.score || left.acoustId.localeCompare(right.acoustId));
}

export async function lookupAcoustIdFingerprint(
  providers: LibraryAssistantProviderGateway,
  input: {
    apiKey: string;
    durationSeconds: number;
    fingerprint: string;
    signal?: AbortSignal;
  },
  options: { fetchImpl?: FetchLike; userAgent?: string } = {}
) {
  const apiKey = input.apiKey.trim();
  if (!apiKey || apiKey.length > 256 || /[\r\n\0]/.test(apiKey)) {
    throw new TypeError('Chave da aplicação AcoustID inválida.');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? ACOUSTID_USER_AGENT;
  const duration = Math.max(1, Math.round(input.durationSeconds));
  const body = new URLSearchParams({
    client: apiKey,
    duration: String(duration),
    fingerprint: input.fingerprint,
    meta: 'recordings releasegroups compress',
    format: 'json'
  });

  const result = await providers.query({
    provider: { source: 'acoustid', version: ACOUSTID_PROVIDER_VERSION, userAgent },
    cacheKey: `lookup:${duration}:${input.fingerprint}`,
    ttlMs: ACOUSTID_CACHE_TTL_MS,
    signal: input.signal,
    execute: async ({ signal, userAgent: providerUserAgent }) => {
      const response = await fetchImpl(ACOUSTID_LOOKUP_URL, {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': providerUserAgent
        },
        body
      });
      if (!response.ok) {
        const error = new Error(response.status === 429 || response.status === 503
          ? 'AcoustID temporariamente indisponível. Tente novamente mais tarde.'
          : 'Falha ao consultar AcoustID.');
        Object.assign(error, {
          code: response.status === 429 || response.status === 503
            ? 'provider-rate-limited'
            : 'provider-request-failed',
          statusCode: response.status
        });
        throw error;
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARS) {
        throw new LibraryAssistantProviderResponseError();
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) throw new LibraryAssistantProviderResponseError();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new LibraryAssistantProviderResponseError();
      }
    },
    normalize: normalizeAcoustIdFingerprintLookup
  });

  return result.value;
}
