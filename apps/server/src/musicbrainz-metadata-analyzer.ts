import type { Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantConfidenceBand,
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

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_PROVIDER_VERSION = 'ws2-recording-search-v1';
const MUSICBRAINZ_USER_AGENT = 'HomeMusic/0.1 (+https://github.com/felipe-urgal/home-music)';
const MUSICBRAINZ_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_CANDIDATES = 5;
const AMBIGUOUS_MARGIN = 15;
const HIGH_MARGIN = 18;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type MusicBrainzRelease = {
  id: string;
  title: string;
  releaseGroupId: string | null;
  albumArtist: string | null;
  albumArtistId: string | null;
};

export type MusicBrainzRecordingCandidate = {
  recordingId: string;
  title: string;
  artist: string;
  artistId: string | null;
  durationSeconds: number | null;
  releases: MusicBrainzRelease[];
};

type RankedCandidate = {
  candidate: MusicBrainzRecordingCandidate;
  release: MusicBrainzRelease | null;
  score: number;
  evidence: LibraryAssistantEvidence[];
  reasonCodes: LibraryAssistantReasonCode[];
  blockingConflict: boolean;
};

type TrackMatch = {
  track: Track;
  ranked: RankedCandidate[];
};

type AnalyzerOptions = {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  userAgent?: string;
  getHumanOverrideFields?: (trackId: string) => readonly LibraryAssistantMetadataField[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, max = 240) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max ? clean : null;
}

function safeId(value: unknown) {
  const clean = safeText(value, 80);
  return clean && /^[A-Za-z0-9-]+$/.test(clean) ? clean : null;
}

function artistCredit(value: unknown): { name: string | null; id: string | null } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return { name: null, id: null };
  const parts: string[] = [];
  let firstId: string | null = null;
  for (const rawCredit of value) {
    const credit = record(rawCredit);
    if (!credit) continue;
    const artist = record(credit.artist);
    const name = safeText(credit.name) ?? safeText(artist?.name);
    if (name) parts.push(name);
    const join = safeText(credit.joinphrase, 32);
    if (join && parts.length) parts[parts.length - 1] += join;
    firstId ??= safeId(artist?.id);
  }
  const name = parts.join('').trim();
  return { name: name && name.length <= 240 ? name : null, id: firstId };
}

function normalizeRelease(value: unknown): MusicBrainzRelease | null {
  const item = record(value);
  if (!item) return null;
  const id = safeId(item.id);
  const title = safeText(item.title);
  if (!id || !title) return null;
  const releaseGroupId = safeId(record(item['release-group'])?.id);
  const credit = artistCredit(item['artist-credit']);
  return {
    id,
    title,
    releaseGroupId,
    albumArtist: credit.name,
    albumArtistId: credit.id
  };
}

export function normalizeMusicBrainzRecordingSearch(payload: unknown): MusicBrainzRecordingCandidate[] {
  const root = record(payload);
  if (!root || !Array.isArray(root.recordings)) throw new LibraryAssistantProviderResponseError();
  if (root.recordings.length > 100) throw new LibraryAssistantProviderResponseError();

  const candidates: MusicBrainzRecordingCandidate[] = [];
  for (const rawRecording of root.recordings.slice(0, MAX_CANDIDATES)) {
    const item = record(rawRecording);
    if (!item) continue;
    const recordingId = safeId(item.id);
    const title = safeText(item.title);
    const credit = artistCredit(item['artist-credit']);
    if (!recordingId || !title || !credit.name) continue;

    const lengthMs = typeof item.length === 'number' && Number.isFinite(item.length) && item.length >= 0
      ? item.length
      : null;
    const rawReleases = Array.isArray(item.releases) ? item.releases.slice(0, 8) : [];
    const releases = rawReleases.map(normalizeRelease).filter((value): value is MusicBrainzRelease => Boolean(value));
    candidates.push({
      recordingId,
      title,
      artist: credit.name,
      artistId: credit.id,
      durationSeconds: lengthMs == null ? null : Math.round(lengthMs / 100) / 10,
      releases
    });
  }
  return candidates;
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

function bestRelease(track: Track, candidate: MusicBrainzRecordingCandidate) {
  if (!candidate.releases.length) return null;
  const album = exactValue(track.album);
  if (!album) return candidate.releases[0];
  return candidate.releases.find(release => compareText(album, release.title) === 'exact')
    ?? candidate.releases.find(release => compareText(album, release.title) === 'normalized')
    ?? candidate.releases[0];
}

export function rankMusicBrainzCandidate(track: Track, candidate: MusicBrainzRecordingCandidate): RankedCandidate {
  const release = bestRelease(track, candidate);
  const evidence: LibraryAssistantEvidence[] = [];
  const reasonCodes = new Set<LibraryAssistantReasonCode>(['provider-match']);
  let score = 0;
  let blockingConflict = false;

  const titleEvidence = textEvidence('title', track.title, candidate.title);
  const artistEvidence = textEvidence('artist', track.artist, candidate.artist);
  evidence.push(titleEvidence, artistEvidence);

  if (titleEvidence.type === 'text-match' && titleEvidence.match === 'exact') {
    score += 40;
    reasonCodes.add('exact-text-match');
  } else if (titleEvidence.type === 'text-match' && titleEvidence.match === 'normalized') {
    score += 32;
    reasonCodes.add('normalized-text-match');
  } else {
    blockingConflict = true;
    reasonCodes.add('metadata-conflict');
  }

  if (artistEvidence.type === 'text-match' && artistEvidence.match === 'exact') {
    score += 40;
    reasonCodes.add('exact-text-match');
  } else if (artistEvidence.type === 'text-match' && artistEvidence.match === 'normalized') {
    score += 32;
    reasonCodes.add('normalized-text-match');
  } else {
    blockingConflict = true;
    reasonCodes.add('metadata-conflict');
  }

  if (release && track.album.trim()) {
    const albumEvidence = textEvidence('album', track.album, release.title);
    evidence.push(albumEvidence);
    if (albumEvidence.type === 'text-match' && albumEvidence.match === 'exact') {
      score += 16;
      reasonCodes.add('exact-text-match');
    } else if (albumEvidence.type === 'text-match' && albumEvidence.match === 'normalized') {
      score += 12;
      reasonCodes.add('normalized-text-match');
    } else {
      score -= 8;
      reasonCodes.add('metadata-conflict');
    }
  }

  if (release?.albumArtist && track.albumArtist.trim()) {
    const albumArtistEvidence = textEvidence('albumArtist', track.albumArtist, release.albumArtist);
    evidence.push(albumArtistEvidence);
    if (albumArtistEvidence.type === 'text-match' && albumArtistEvidence.match === 'exact') score += 5;
    else if (albumArtistEvidence.type === 'text-match' && albumArtistEvidence.match === 'normalized') score += 3;
  }

  if (track.duration != null && candidate.durationSeconds != null) {
    const deltaSeconds = Math.round(Math.abs(track.duration - candidate.durationSeconds) * 10) / 10;
    evidence.push({ type: 'duration-delta', version: LIBRARY_ASSISTANT_CONTRACT_VERSION, deltaSeconds });
    if (deltaSeconds <= 2) {
      score += 12;
      reasonCodes.add('duration-close');
    } else if (deltaSeconds <= 5) {
      score += 7;
      reasonCodes.add('duration-close');
    } else if (deltaSeconds >= 12) {
      score -= 22;
      blockingConflict = true;
      reasonCodes.add('duration-mismatch');
    }
  }

  evidence.push({
    type: 'external-id',
    version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
    source: 'musicbrainz',
    kind: 'recording',
    id: candidate.recordingId
  });
  if (candidate.artistId) evidence.push({
    type: 'external-id',
    version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
    source: 'musicbrainz',
    kind: 'artist',
    id: candidate.artistId
  });
  if (release) {
    evidence.push({
      type: 'external-id',
      version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
      source: 'musicbrainz',
      kind: 'release',
      id: release.id
    });
    if (release.releaseGroupId) evidence.push({
      type: 'external-id',
      version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
      source: 'musicbrainz',
      kind: 'release-group',
      id: release.releaseGroupId
    });
  }

  return { candidate, release, score, evidence, reasonCodes: [...reasonCodes], blockingConflict };
}

function albumGroupKey(track: Track) {
  const album = normalizedValue(track.album);
  const artist = normalizedValue(track.albumArtist || track.artist);
  return album ? `${artist}\u0000${album}` : '';
}

function confidenceFor(match: RankedCandidate, margin: number, humanOverride: boolean): LibraryAssistantConfidenceBand | null {
  if (match.blockingConflict || match.score < 55) return null;
  if (humanOverride) return 'low';
  if (match.score >= 88 && margin >= HIGH_MARGIN) return 'high';
  if (match.score >= 68 && margin >= 8) return 'medium';
  return 'low';
}

function queryText(track: Track) {
  const terms = [`recording:${JSON.stringify(exactValue(track.title))}`, `artist:${JSON.stringify(exactValue(track.artist))}`];
  if (track.album.trim()) terms.push(`release:${JSON.stringify(exactValue(track.album))}`);
  return terms.join(' AND ');
}

function cacheKey(track: Track) {
  return JSON.stringify({
    title: exactValue(track.title),
    artist: exactValue(track.artist),
    album: exactValue(track.album)
  });
}

async function fetchCandidates(
  track: Track,
  providers: LibraryAssistantProviderGateway,
  fetchImpl: FetchLike,
  baseUrl: string,
  userAgent: string,
  signal?: AbortSignal
) {
  const query = queryText(track);
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/recording`);
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(MAX_CANDIDATES));

  const result = await providers.query({
    provider: { source: 'musicbrainz', version: MUSICBRAINZ_PROVIDER_VERSION, userAgent },
    cacheKey: cacheKey(track),
    ttlMs: MUSICBRAINZ_CACHE_TTL_MS,
    signal,
    execute: async ({ signal: providerSignal, userAgent: providerUserAgent }) => {
      const response = await fetchImpl(url, {
        signal: providerSignal,
        headers: {
          Accept: 'application/json',
          'User-Agent': providerUserAgent
        }
      });
      if (!response.ok) {
        const error = new Error(response.status === 429 || response.status === 503
          ? 'MusicBrainz temporariamente indisponível. Tente novamente mais tarde.'
          : 'Falha ao consultar MusicBrainz.');
        Object.assign(error, { code: response.status === 429 || response.status === 503 ? 'provider-rate-limited' : 'provider-request-failed' });
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
    normalize: normalizeMusicBrainzRecordingSearch
  });
  return result.value;
}

function metadataValues(match: RankedCandidate) {
  return {
    title: match.candidate.title,
    artist: match.candidate.artist,
    album: match.release?.title ?? '',
    albumArtist: match.release?.albumArtist ?? match.candidate.artist
  } satisfies Record<LibraryAssistantMetadataField, string>;
}

export function createMusicBrainzMetadataAnalyzer(options: AnalyzerOptions = {}): LibraryAssistantAnalyzer {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? MUSICBRAINZ_BASE_URL;
  const userAgent = options.userAgent ?? MUSICBRAINZ_USER_AGENT;

  return {
    id: `musicbrainz-metadata-${MUSICBRAINZ_PROVIDER_VERSION}`,
    capability: 'metadata',
    async analyze({ tracks, signal, providers }) {
      const matches: TrackMatch[] = [];
      for (const track of tracks) {
        if (signal?.aborted) break;
        if (!track.title.trim() || !track.artist.trim()) continue;
        const candidates = await fetchCandidates(track, providers, fetchImpl, baseUrl, userAgent, signal);
        const ranked = candidates
          .map(candidate => rankMusicBrainzCandidate(track, candidate))
          .sort((left, right) => right.score - left.score)
          .slice(0, MAX_CANDIDATES);
        matches.push({ track, ranked });
      }

      const albumContext = new Map<string, Map<string, number>>();
      const groupSizes = new Map<string, number>();
      for (const match of matches) {
        const key = albumGroupKey(match.track);
        if (!key) continue;
        groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
        const releaseId = match.ranked[0]?.release?.id;
        if (!releaseId) continue;
        const releases = albumContext.get(key) ?? new Map<string, number>();
        releases.set(releaseId, (releases.get(releaseId) ?? 0) + 1);
        albumContext.set(key, releases);
      }

      const drafts: LibraryAssistantSuggestionDraft[] = [];
      for (const { track, ranked } of matches) {
        const best = ranked[0];
        if (!best) continue;
        const second = ranked[1];
        let margin = second ? best.score - second.score : 100;
        const reasonCodes = new Set(best.reasonCodes);
        const evidence = [...best.evidence];
        const key = albumGroupKey(track);
        const releaseId = best.release?.id;
        if (key && releaseId) {
          const matchedTracks = albumContext.get(key)?.get(releaseId) ?? 0;
          const totalTracks = groupSizes.get(key) ?? 0;
          if (matchedTracks >= 2 && totalTracks >= 2) {
            best.score += 8;
            margin += 4;
            reasonCodes.add('album-context');
            evidence.push({
              type: 'album-context',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              matchedTracks,
              totalTracks
            });
          }
        }
        if (second && margin < AMBIGUOUS_MARGIN) reasonCodes.add('ambiguous-candidates');

        const values = metadataValues(best);
        const humanFields = new Set(options.getHumanOverrideFields?.(track.id) ?? []);
        for (const field of ['title', 'artist', 'album', 'albumArtist'] as const) {
          const suggestedValue = values[field].trim();
          if (!suggestedValue || exactValue(track[field]) === exactValue(suggestedValue)) continue;
          const humanOverride = humanFields.has(field);
          const confidence = confidenceFor(best, margin, humanOverride);
          if (!confidence) continue;
          const fieldReasonCodes = new Set(reasonCodes);
          const fieldEvidence = [...evidence];
          if (humanOverride) {
            fieldReasonCodes.add('human-override');
            fieldEvidence.push({
              type: 'human-override',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              field
            });
          }
          drafts.push({
            capability: 'metadata',
            confidence,
            reasonCodes: [...fieldReasonCodes],
            evidence: fieldEvidence,
            provenance: {
              source: 'musicbrainz',
              providerVersion: MUSICBRAINZ_PROVIDER_VERSION,
              externalId: best.candidate.recordingId
            },
            target: {
              capability: 'metadata',
              trackId: track.id,
              field,
              currentValue: track[field],
              suggestedValue
            }
          });
        }
      }
      return drafts;
    }
  };
}
