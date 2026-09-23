import type { Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantEvidence,
  type LibraryAssistantReasonCode
} from '@home-music/shared/library-assistant';
import {
  COVER_ART_ARCHIVE_PROVIDER_VERSION,
  findCoverArtArchiveFrontCover,
  findCoverArtArchiveReleaseGroupFrontCover
} from './cover-art-archive.js';
import {
  LibraryAssistantProviderResponseError,
  type LibraryAssistantProviderGateway
} from './library-assistant-provider.js';
import type {
  LibraryAssistantAnalyzer,
  LibraryAssistantSuggestionDraft
} from './library-assistant-service.js';

const MUSICBRAINZ_BASE_URL = 'https://musicbrainz.org/ws/2';
const MUSICBRAINZ_PROVIDER_VERSION = 'ws2-release-search-v1';
const MUSICBRAINZ_USER_AGENT = 'HomeMusic/0.1 (+https://github.com/felipe-urgal/home-music)';
const MUSICBRAINZ_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_CANDIDATES = 5;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type MusicBrainzReleaseCandidate = {
  id: string;
  title: string;
  releaseGroupId: string | null;
  albumArtist: string;
};

type AnalyzerOptions = {
  fetchImpl?: FetchLike;
  userAgent?: string;
};

const PLACEHOLDERS = new Set([
  '',
  'unknown artist',
  'unknown album',
  'artista desconhecido',
  'album desconhecido'
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeText(value: unknown, max = 240) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= max && !/[\r\n\t]/.test(clean) ? clean : null;
}

function safeId(value: unknown) {
  const clean = safeText(value, 80);
  return clean && /^[A-Za-z0-9-]+$/.test(clean) ? clean : null;
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

function reliable(value: string) {
  return !PLACEHOLDERS.has(normalizedValue(value));
}

function compareText(source: string, candidate: string): 'exact' | 'normalized' | 'different' {
  const left = exactValue(source);
  const right = exactValue(candidate);
  if (left === right) return 'exact';
  return normalizedValue(left) === normalizedValue(right) ? 'normalized' : 'different';
}

function artistCredit(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const parts: string[] = [];
  for (const rawCredit of value) {
    const credit = record(rawCredit);
    if (!credit) continue;
    const artist = record(credit.artist);
    const name = safeText(credit.name) ?? safeText(artist?.name);
    if (!name) continue;
    const join = safeText(credit.joinphrase, 32);
    parts.push(join ? name + join : name);
  }
  const result = parts.join('').trim();
  return result && result.length <= 240 ? result : null;
}

function normalizeCandidate(value: unknown): MusicBrainzReleaseCandidate | null {
  const item = record(value);
  if (!item) return null;
  const id = safeId(item.id);
  const title = safeText(item.title);
  const albumArtist = safeText(item.albumArtist) ?? artistCredit(item['artist-credit']);
  const releaseGroupId = item.releaseGroupId == null
    ? safeId(record(item['release-group'])?.id)
    : safeId(item.releaseGroupId);
  if (!id || !title || !albumArtist) return null;
  return { id, title, releaseGroupId, albumArtist };
}

export function normalizeMusicBrainzReleaseSearch(payload: unknown): MusicBrainzReleaseCandidate[] {
  if (Array.isArray(payload)) {
    if (payload.length > MAX_CANDIDATES) throw new LibraryAssistantProviderResponseError();
    const cached = payload.map(normalizeCandidate);
    if (cached.some(candidate => candidate == null)) throw new LibraryAssistantProviderResponseError();
    return cached as MusicBrainzReleaseCandidate[];
  }

  const root = record(payload);
  const releases = root?.releases;
  if (!Array.isArray(releases) || releases.length > 100) {
    throw new LibraryAssistantProviderResponseError();
  }
  return releases
    .slice(0, MAX_CANDIDATES)
    .map(normalizeCandidate)
    .filter((candidate): candidate is MusicBrainzReleaseCandidate => Boolean(candidate));
}

function albumIdentity(track: Track) {
  if (!reliable(track.album)) return null;
  const artist = reliable(track.albumArtist)
    ? exactValue(track.albumArtist)
    : reliable(track.artist)
      ? exactValue(track.artist)
      : '';
  if (!artist) return null;
  return {
    album: exactValue(track.album),
    artist,
    key: `${normalizedValue(artist)}\u0000${normalizedValue(track.album)}`
  };
}

function queryText(album: string, artist: string) {
  return [
    `release:${JSON.stringify(album)}`,
    `artist:${JSON.stringify(artist)}`
  ].join(' AND ');
}

function cacheKey(album: string, artist: string) {
  return JSON.stringify({
    album: normalizedValue(album),
    artist: normalizedValue(artist)
  });
}

async function fetchReleaseCandidates(
  album: string,
  artist: string,
  providers: LibraryAssistantProviderGateway,
  fetchImpl: FetchLike,
  userAgent: string,
  signal?: AbortSignal
) {
  const url = new URL(`${MUSICBRAINZ_BASE_URL}/release`);
  url.searchParams.set('query', queryText(album, artist));
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(MAX_CANDIDATES));

  const result = await providers.query({
    provider: { source: 'musicbrainz', version: MUSICBRAINZ_PROVIDER_VERSION, userAgent },
    cacheKey: cacheKey(album, artist),
    ttlMs: MUSICBRAINZ_CACHE_TTL_MS,
    signal,
    execute: async ({ signal: providerSignal, userAgent: providerUserAgent }) => {
      const response = await fetchImpl(url, {
        signal: providerSignal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': providerUserAgent
        }
      });
      if (!response.ok) {
        const error = new Error(response.status === 429 || response.status === 503
          ? 'MusicBrainz temporariamente indisponível. Tente novamente mais tarde.'
          : 'Falha ao consultar MusicBrainz.');
        Object.assign(error, {
          code: response.status === 429 || response.status === 503
            ? 'provider-rate-limited'
            : 'provider-request-failed'
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
    normalize: normalizeMusicBrainzReleaseSearch
  });
  return result.value;
}

function rankRelease(
  album: string,
  artist: string,
  candidate: MusicBrainzReleaseCandidate
) {
  const albumMatch = compareText(album, candidate.title);
  const artistMatch = compareText(artist, candidate.albumArtist);
  let score = 0;
  if (albumMatch === 'exact') score += 50;
  else if (albumMatch === 'normalized') score += 45;
  if (artistMatch === 'exact') score += 40;
  else if (artistMatch === 'normalized') score += 35;
  return { candidate, albumMatch, artistMatch, score };
}

async function findArtwork(
  candidate: MusicBrainzReleaseCandidate,
  options: {
    providers: LibraryAssistantProviderGateway;
    fetchImpl: FetchLike;
    userAgent: string;
    signal?: AbortSignal;
  }
) {
  // Para preenchimento automático importa mais uma capa coerente com o álbum
  // do que acertar a edição física exata. O release-group tende a representar
  // melhor essa identidade compartilhada entre reedições/remasters.
  if (candidate.releaseGroupId) {
    const releaseGroup = await findCoverArtArchiveReleaseGroupFrontCover({
      releaseGroupId: candidate.releaseGroupId,
      ...options
    });
    if (releaseGroup) return releaseGroup;
  }

  return findCoverArtArchiveFrontCover({
    releaseId: candidate.id,
    ...options
  });
}

export function createMusicBrainzAlbumArtworkAnalyzer(
  options: AnalyzerOptions = {}
): LibraryAssistantAnalyzer {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? MUSICBRAINZ_USER_AGENT;

  return {
    id: `musicbrainz-album-artwork-${MUSICBRAINZ_PROVIDER_VERSION}`,
    capability: 'artwork',
    async analyze({ tracks, signal, providers }) {
      const groups = new Map<string, { album: string; artist: string; tracks: Track[] }>();
      for (const track of tracks) {
        if (track.hasCover) continue;
        const identity = albumIdentity(track);
        if (!identity) continue;
        const group = groups.get(identity.key) ?? {
          album: identity.album,
          artist: identity.artist,
          tracks: []
        };
        group.tracks.push(track);
        groups.set(identity.key, group);
      }

      const drafts: LibraryAssistantSuggestionDraft[] = [];
      for (const group of groups.values()) {
        if (signal?.aborted) break;
        const candidates = await fetchReleaseCandidates(
          group.album,
          group.artist,
          providers,
          fetchImpl,
          userAgent,
          signal
        );
        const ranked = candidates
          .map(candidate => rankRelease(group.album, group.artist, candidate))
          .filter(item => item.albumMatch !== 'different' && item.artistMatch !== 'different')
          .sort((left, right) => right.score - left.score);
        const seenReleaseGroups = new Set<string>();
        const distinct = ranked.filter(item => {
          const key = item.candidate.releaseGroupId ?? item.candidate.id;
          if (seenReleaseGroups.has(key)) return false;
          seenReleaseGroups.add(key);
          return true;
        });
        const plausible = distinct.filter(item => item.score >= 80);
        if (plausible.length === 0) continue;

        let resolved: {
          match: (typeof plausible)[number];
          artwork: NonNullable<Awaited<ReturnType<typeof findArtwork>>>;
        } | null = null;
        for (const match of plausible) {
          try {
            const artwork = await findArtwork(match.candidate, {
              providers,
              fetchImpl,
              userAgent,
              signal
            });
            if (artwork) {
              resolved = { match, artwork };
              break;
            }
          } catch {
            // Outra edição coerente do mesmo álbum ainda pode ter artwork.
          }
        }
        if (!resolved) continue;
        const best = resolved.match;
        const artwork = resolved.artwork;

        for (const track of group.tracks) {
          const albumMatch = compareText(track.album, best.candidate.title);
          const artistSource = reliable(track.albumArtist) ? track.albumArtist : track.artist;
          const artistMatch = compareText(artistSource, best.candidate.albumArtist);
          const evidence: LibraryAssistantEvidence[] = [
            {
              type: 'text-match',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              field: 'album',
              match: albumMatch,
              sourceValue: track.album,
              candidateValue: best.candidate.title
            },
            {
              type: 'text-match',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              field: 'albumArtist',
              match: artistMatch,
              sourceValue: artistSource,
              candidateValue: best.candidate.albumArtist
            },
            {
              type: 'external-id',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              source: 'musicbrainz',
              kind: 'release',
              id: best.candidate.id
            }
          ];
          if (best.candidate.releaseGroupId) {
            evidence.push({
              type: 'external-id',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              source: 'musicbrainz',
              kind: 'release-group',
              id: best.candidate.releaseGroupId
            });
          }
          if (group.tracks.length > 1) {
            evidence.push({
              type: 'album-context',
              version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
              matchedTracks: group.tracks.length,
              totalTracks: group.tracks.length
            });
          }

          const reasonCodes = new Set<LibraryAssistantReasonCode>([
            'provider-match',
            'artwork-missing',
            'strong-external-id'
          ]);
          reasonCodes.add(albumMatch === 'exact' && artistMatch === 'exact'
            ? 'exact-text-match'
            : 'normalized-text-match');
          if (group.tracks.length > 1) reasonCodes.add('album-context');

          drafts.push({
            capability: 'artwork',
            confidence: 'high',
            reasonCodes: [...reasonCodes],
            evidence,
            provenance: {
              source: 'cover-art-archive',
              providerVersion: COVER_ART_ARCHIVE_PROVIDER_VERSION,
              externalId: best.candidate.id
            },
            target: {
              capability: 'artwork',
              trackId: track.id,
              candidateId: `cover-art-archive:${best.candidate.id}:${artwork.id}`,
              label: `Capa frontal — ${best.candidate.title}`,
              sourceUrl: artwork.imageUrl,
              thumbnailUrl: artwork.thumbnailUrl,
              currentHasCover: Boolean(track.hasCover),
              currentCoverVersion: track.hasCover ? track.coverVersion ?? 'physical' : null,
              musicBrainzReleaseId: best.candidate.id,
              musicBrainzReleaseGroupId: best.candidate.releaseGroupId
            }
          });
        }
      }
      return drafts;
    }
  };
}
