import type { Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantEvidence,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReasonCode
} from '@home-music/shared/library-assistant';
import {
  LibraryAssistantProviderResponseError,
  type LibraryAssistantProviderGateway
} from './library-assistant-provider.js';
import type {
  LibraryAssistantAnalyzer,
  LibraryAssistantSuggestionDraft
} from './library-assistant-service.js';
import { parseLyrics } from './lyrics.js';

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
export const LRCLIB_PROVIDER_VERSION = 'api-v1-search-get';
const LRCLIB_USER_AGENT = 'HomeMusic/0.1 (+https://github.com/felipe-urgal/home-music)';
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const RECORD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_HTTP_RESPONSE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 20;
const MAX_LYRICS_BYTES = 48 * 1024;
const MAX_PREVIEW_LENGTH = 220;
const AMBIGUOUS_MARGIN = 8;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type LrclibSearchCandidate = {
  id: string;
  trackName: string;
  artistName: string;
  albumName: string;
  durationSeconds: number | null;
  synchronized: boolean;
  preview: string;
};

type RankedCandidate = {
  candidate: LrclibSearchCandidate;
  score: number;
  evidence: LibraryAssistantEvidence[];
  reasonCodes: LibraryAssistantReasonCode[];
  blockingConflict: boolean;
  durationClose: boolean;
};

export type ResolvedLrclibLyrics = {
  candidateId: string;
  synchronized: boolean;
  language: string | null;
  text: string;
};

type AnalyzerOptions = {
  fetchImpl?: FetchLike;
  userAgent?: string;
  hasEffectiveLyrics?: (trackId: string) => Promise<boolean> | boolean;
};

class LrclibHttpError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryAfterMs?: number;

  constructor(statusCode: number, retryAfterMs?: number) {
    super(statusCode === 429
      ? 'O LRCLIB limitou temporariamente as consultas.'
      : 'O LRCLIB não está disponível no momento.');
    this.name = 'LrclibHttpError';
    this.statusCode = statusCode;
    this.code = statusCode === 429 ? 'provider-rate-limited' : 'provider-unavailable';
    this.retryAfterMs = retryAfterMs;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= maximum ? clean : null;
}

function safeCandidateId(value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d{1,18}$/.test(value)) return value;
  return null;
}

function safeDuration(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 24 * 60 * 60) return null;
  return Math.round(value * 10) / 10;
}

function rawLyrics(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/^\uFEFF/, '').trim();
  if (!clean || Buffer.byteLength(clean, 'utf8') > MAX_LYRICS_BYTES) return null;
  return clean;
}

function lyricsPreview(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const clean = value
      .replace(/\[[^\]\r\n]{1,80}\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean) return clean.slice(0, MAX_PREVIEW_LENGTH);
  }
  return '';
}

function normalizeCachedCandidate(value: unknown): LrclibSearchCandidate | null {
  const item = record(value);
  if (!item) return null;
  const id = safeCandidateId(item.id);
  const trackName = safeText(item.trackName);
  const artistName = safeText(item.artistName);
  const albumName = typeof item.albumName === 'string' ? item.albumName.trim().slice(0, 240) : '';
  const durationSeconds = item.durationSeconds == null ? null : safeDuration(item.durationSeconds);
  const preview = safeText(item.preview, MAX_PREVIEW_LENGTH);
  if (!id || !trackName || !artistName || !preview || typeof item.synchronized !== 'boolean') return null;
  if (item.durationSeconds != null && durationSeconds == null) return null;
  return { id, trackName, artistName, albumName, durationSeconds, synchronized: item.synchronized, preview };
}

export function normalizeLrclibSearch(payload: unknown): LrclibSearchCandidate[] {
  if (!Array.isArray(payload)) throw new LibraryAssistantProviderResponseError();
  if (payload.length > MAX_SEARCH_RESULTS) throw new LibraryAssistantProviderResponseError();

  const cached = payload.map(normalizeCachedCandidate);
  if (cached.every(candidate => candidate != null)) return cached as LrclibSearchCandidate[];

  const candidates: LrclibSearchCandidate[] = [];
  for (const rawItem of payload) {
    const item = record(rawItem);
    if (!item || item.instrumental === true) continue;
    const id = safeCandidateId(item.id);
    const trackName = safeText(item.trackName ?? item.name);
    const artistName = safeText(item.artistName);
    const albumName = safeText(item.albumName) ?? '';
    const durationSeconds = safeDuration(item.duration);
    const synced = rawLyrics(item.syncedLyrics);
    const plain = rawLyrics(item.plainLyrics);
    const preview = lyricsPreview(synced, plain);
    if (!id || !trackName || !artistName || !preview || (!synced && !plain)) continue;
    candidates.push({
      id,
      trackName,
      artistName,
      albumName,
      durationSeconds,
      synchronized: Boolean(synced),
      preview
    });
  }
  return candidates;
}

export function normalizeLrclibRecord(payload: unknown): ResolvedLrclibLyrics | null {
  if (payload == null) return null;
  const item = record(payload);
  if (!item || item.instrumental === true) return null;
  const id = safeCandidateId(item.id);
  if (!id) throw new LibraryAssistantProviderResponseError();

  const synced = rawLyrics(item.syncedLyrics);
  if (synced) {
    const parsed = parseLyrics(synced, 'lrc');
    if (parsed.lines.length > 0 && parsed.synchronized) {
      return { candidateId: `lrclib:${id}`, synchronized: true, language: null, text: synced };
    }
  }

  const plain = rawLyrics(item.plainLyrics);
  if (plain) {
    const parsed = parseLyrics(plain, 'txt');
    if (parsed.lines.length > 0) {
      return { candidateId: `lrclib:${id}`, synchronized: false, language: null, text: plain };
    }
  }
  throw new LibraryAssistantProviderResponseError();
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2 * 60 * 60 * 1_000, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.min(2 * 60 * 60 * 1_000, date - Date.now()));
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: URL,
  signal: AbortSignal,
  userAgent: string,
  notFoundValue: unknown
) {
  const response = await fetchImpl(url, {
    method: 'GET',
    signal,
    headers: { Accept: 'application/json', 'User-Agent': userAgent }
  });
  if (response.status === 404) return notFoundValue;
  if (!response.ok) {
    throw new LrclibHttpError(response.status, parseRetryAfter(response.headers.get('retry-after')));
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_RESPONSE_BYTES) {
    throw new LibraryAssistantProviderResponseError();
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_HTTP_RESPONSE_BYTES) {
    throw new LibraryAssistantProviderResponseError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LibraryAssistantProviderResponseError();
  }
}

function exactValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizedValue(value: string) {
  return exactValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US');
}

function compareText(source: string, candidate: string): 'exact' | 'normalized' | 'different' {
  const sourceExact = exactValue(source);
  const candidateExact = exactValue(candidate);
  if (sourceExact === candidateExact) return 'exact';
  return normalizedValue(sourceExact) === normalizedValue(candidateExact) ? 'normalized' : 'different';
}

function textEvidence(
  field: LibraryAssistantMetadataField,
  sourceValue: string,
  candidateValue: string
): LibraryAssistantEvidence {
  return {
    type: 'text-match',
    version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
    field,
    match: compareText(sourceValue, candidateValue),
    sourceValue,
    candidateValue
  };
}

function rankCandidate(track: Track, candidate: LrclibSearchCandidate): RankedCandidate {
  const evidence: LibraryAssistantEvidence[] = [];
  const reasonCodes = new Set<LibraryAssistantReasonCode>(['provider-match']);
  let score = 0;
  let blockingConflict = false;
  let durationClose = false;

  for (const [field, source, value] of [
    ['title', track.title, candidate.trackName],
    ['artist', track.artist, candidate.artistName]
  ] as const) {
    const item = textEvidence(field, source, value);
    evidence.push(item);
    if (item.match === 'exact') {
      score += 40;
      reasonCodes.add('exact-text-match');
    } else if (item.match === 'normalized') {
      score += 34;
      reasonCodes.add('normalized-text-match');
    } else {
      blockingConflict = true;
      reasonCodes.add('metadata-conflict');
    }
  }

  if (track.album.trim() && candidate.albumName) {
    const album = textEvidence('album', track.album, candidate.albumName);
    evidence.push(album);
    if (album.match === 'exact') {
      score += 14;
      reasonCodes.add('exact-text-match');
    } else if (album.match === 'normalized') {
      score += 10;
      reasonCodes.add('normalized-text-match');
    } else {
      score -= 8;
      reasonCodes.add('metadata-conflict');
    }
  }

  if (track.duration != null && candidate.durationSeconds != null) {
    const deltaSeconds = Math.round(Math.abs(track.duration - candidate.durationSeconds) * 10) / 10;
    evidence.push({ type: 'duration-delta', version: LIBRARY_ASSISTANT_CONTRACT_VERSION, deltaSeconds });
    if (deltaSeconds <= 2) {
      score += 18;
      durationClose = true;
      reasonCodes.add('duration-close');
    } else if (deltaSeconds <= 5) {
      score += 8;
      reasonCodes.add('duration-close');
    } else if (deltaSeconds >= 12) {
      score -= 24;
      blockingConflict = true;
      reasonCodes.add('duration-mismatch');
    }
  }

  evidence.push({
    type: 'external-id',
    version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
    source: 'lrclib',
    id: candidate.id
  });

  return { candidate, score, evidence, reasonCodes: [...reasonCodes], blockingConflict, durationClose };
}

const PLACEHOLDERS = new Set([
  '',
  'unknown title',
  'unknown artist',
  'titulo desconhecido',
  'artista desconhecido'
]);

function reliable(value: string) {
  return !PLACEHOLDERS.has(normalizedValue(value));
}

async function searchLrclib(
  providers: LibraryAssistantProviderGateway,
  track: Track,
  fetchImpl: FetchLike,
  userAgent: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  if (track.album.trim()) query.set('album_name', track.album);
  const url = new URL(`${LRCLIB_BASE_URL}/search?${query.toString()}`);
  return providers.query({
    provider: { source: 'lrclib', version: LRCLIB_PROVIDER_VERSION, userAgent },
    cacheKey: `search:${JSON.stringify({ title: track.title, artist: track.artist, album: track.album })}`,
    ttlMs: SEARCH_CACHE_TTL_MS,
    signal,
    execute: context => fetchJson(fetchImpl, url, context.signal, context.userAgent, []),
    normalize: normalizeLrclibSearch
  });
}

export async function resolveLrclibLyricsCandidate(
  providers: LibraryAssistantProviderGateway,
  candidateId: string,
  options: { fetchImpl?: FetchLike; userAgent?: string; signal?: AbortSignal } = {}
) {
  const match = /^lrclib:(\d{1,18})$/.exec(candidateId);
  if (!match) throw new TypeError('Identificador LRCLIB inválido.');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? LRCLIB_USER_AGENT;
  const url = new URL(`${LRCLIB_BASE_URL}/get/${match[1]}`);
  const result = await providers.query({
    provider: { source: 'lrclib', version: LRCLIB_PROVIDER_VERSION, userAgent },
    cacheKey: `record:${match[1]}`,
    ttlMs: RECORD_CACHE_TTL_MS,
    signal: options.signal,
    execute: context => fetchJson(fetchImpl, url, context.signal, context.userAgent, null),
    normalize: normalizeLrclibRecord
  });
  return result.value;
}

export function createLrclibLyricsAnalyzer(options: AnalyzerOptions = {}): LibraryAssistantAnalyzer {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? LRCLIB_USER_AGENT;

  return {
    id: `lrclib-lyrics-${LRCLIB_PROVIDER_VERSION}`,
    // O fluxo administrativo atual inicia uma análise de metadata que também
    // agrega artwork. Lyrics reutiliza o mesmo run para manter uma revisão única.
    capability: 'metadata',
    async analyze({ tracks, signal, providers }) {
      const drafts: LibraryAssistantSuggestionDraft[] = [];
      for (const track of tracks) {
        if (signal?.aborted) break;
        if (!reliable(track.title) || !reliable(track.artist)) continue;
        if (await options.hasEffectiveLyrics?.(track.id)) continue;

        const { value: candidates } = await searchLrclib(providers, track, fetchImpl, userAgent, signal);
        if (!candidates.length) continue;
        const ranked = candidates.map(candidate => rankCandidate(track, candidate))
          .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
        const best = ranked[0];
        if (!best || best.evidence.slice(0, 2).some(item => item.type === 'text-match' && item.match === 'different')) continue;

        const reasonCodes = new Set(best.reasonCodes);
        const second = ranked[1];
        const ambiguous = Boolean(second && !second.blockingConflict && best.score - second.score <= AMBIGUOUS_MARGIN);
        if (ambiguous) reasonCodes.add('ambiguous-candidates');
        const confidence = !best.blockingConflict && best.durationClose && !ambiguous ? 'high' : 'medium';

        drafts.push({
          capability: 'lyrics',
          confidence,
          reasonCodes: [...reasonCodes],
          evidence: best.evidence,
          provenance: {
            source: 'lrclib',
            providerVersion: LRCLIB_PROVIDER_VERSION,
            externalId: best.candidate.id
          },
          target: {
            capability: 'lyrics',
            trackId: track.id,
            candidateId: `lrclib:${best.candidate.id}`,
            synchronized: best.candidate.synchronized,
            language: null,
            currentValue: '',
            preview: best.candidate.preview
          }
        });
      }
      return drafts;
    }
  };
}
