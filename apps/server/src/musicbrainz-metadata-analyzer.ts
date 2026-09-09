import type { Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantConfidenceBand,
  type LibraryAssistantEvidence,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReasonCode
} from '@home-music/shared/library-assistant';
import {
  COVER_ART_ARCHIVE_PROVIDER_VERSION,
  findCoverArtArchiveFrontCover
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
const MUSICBRAINZ_PROVIDER_VERSION = 'ws2-recording-search-v2';
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

type SafeFileContext = {
  fileName: string;
  folderName: string | null;
};

type SearchIdentity = {
  title: string;
  artist: string;
  album: string;
  usedFileContext: boolean;
  fileContext: SafeFileContext | null;
};

type TrackMatch = {
  track: Track;
  matchTrack: Track;
  usedFileContext: boolean;
  fileContext: SafeFileContext | null;
  ranked: RankedCandidate[];
};

type AnalyzerOptions = {
  fetchImpl?: FetchLike;
  userAgent?: string;
  getHumanOverrideFields?: (trackId: string) => readonly LibraryAssistantMetadataField[];
  getFileContext?: (trackId: string) => SafeFileContext | null;
};

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

function normalizeCachedRelease(value: unknown): MusicBrainzRelease | null {
  const item = record(value);
  if (!item) return null;
  const id = safeId(item.id);
  const title = safeText(item.title);
  if (!id || !title) return null;
  const releaseGroupId = item.releaseGroupId == null ? null : safeId(item.releaseGroupId);
  const albumArtist = item.albumArtist == null ? null : safeText(item.albumArtist);
  const albumArtistId = item.albumArtistId == null ? null : safeId(item.albumArtistId);
  if (item.releaseGroupId != null && !releaseGroupId) return null;
  if (item.albumArtist != null && !albumArtist) return null;
  if (item.albumArtistId != null && !albumArtistId) return null;
  return { id, title, releaseGroupId, albumArtist, albumArtistId };
}

function normalizeCachedCandidate(value: unknown): MusicBrainzRecordingCandidate | null {
  const item = record(value);
  if (!item) return null;
  const recordingId = safeId(item.recordingId);
  const title = safeText(item.title);
  const artist = safeText(item.artist);
  if (!recordingId || !title || !artist) return null;
  const artistId = item.artistId == null ? null : safeId(item.artistId);
  if (item.artistId != null && !artistId) return null;

  let durationSeconds: number | null = null;
  if (item.durationSeconds != null) {
    if (
      typeof item.durationSeconds !== 'number'
      || !Number.isFinite(item.durationSeconds)
      || item.durationSeconds < 0
      || item.durationSeconds > 24 * 60 * 60
    ) return null;
    durationSeconds = item.durationSeconds;
  }

  if (!Array.isArray(item.releases) || item.releases.length > 8) return null;
  const releases = item.releases.map(normalizeCachedRelease);
  if (releases.some(release => release == null)) return null;
  return {
    recordingId,
    title,
    artist,
    artistId,
    durationSeconds,
    releases: releases as MusicBrainzRelease[]
  };
}

export function normalizeMusicBrainzRecordingSearch(payload: unknown): MusicBrainzRecordingCandidate[] {
  // O gateway persiste o valor já normalizado. A normalização precisa ser idempotente
  // para que um cache hit não invalide a própria entrada e refaça a consulta externa.
  if (Array.isArray(payload)) {
    if (payload.length > MAX_CANDIDATES) throw new LibraryAssistantProviderResponseError();
    const cached = payload.map(normalizeCachedCandidate);
    if (cached.some(candidate => candidate == null)) throw new LibraryAssistantProviderResponseError();
    return cached as MusicBrainzRecordingCandidate[];
  }

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

const PLACEHOLDERS = new Set([
  '',
  'unknown title',
  'unknown artist',
  'unknown album',
  'titulo desconhecido',
  'artista desconhecido',
  'album desconhecido'
]);

function reliableMetadata(value: string) {
  return !PLACEHOLDERS.has(normalizedValue(value));
}

export function needsMusicBrainzMetadataRepair(track: Track) {
  return !reliableMetadata(track.title)
    || !reliableMetadata(track.artist)
    || !reliableMetadata(track.album)
    || !reliableMetadata(track.albumArtist);
}

function safeFileContext(value: SafeFileContext | null | undefined): SafeFileContext | null {
  if (!value) return null;
  const fileName = safeText(value.fileName, 255);
  const folderName = value.folderName == null ? null : safeText(value.folderName, 255);
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) return null;
  if (folderName && (folderName.includes('/') || folderName.includes('\\'))) return null;
  return { fileName, folderName };
}

function fileStem(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot).trim() : fileName.trim();
}

function parseArtistTitleFromFile(fileName: string) {
  const stem = fileStem(fileName);
  const separators = [' - ', ' – ', ' — '] as const;
  for (const separator of separators) {
    const first = stem.indexOf(separator);
    if (first <= 0 || first !== stem.lastIndexOf(separator)) continue;
    const artist = safeText(stem.slice(0, first));
    const title = safeText(stem.slice(first + separator.length));
    if (artist && title) return { artist, title };
  }
  return null;
}

function searchIdentity(track: Track, fileContext: SafeFileContext | null): SearchIdentity | null {
  const titleReliable = reliableMetadata(track.title);
  const artistReliable = reliableMetadata(track.artist);
  const albumReliable = reliableMetadata(track.album);
  if (titleReliable && artistReliable) {
    return {
      title: exactValue(track.title),
      artist: exactValue(track.artist),
      album: albumReliable ? exactValue(track.album) : '',
      usedFileContext: false,
      fileContext
    };
  }

  const parsed = fileContext ? parseArtistTitleFromFile(fileContext.fileName) : null;
  if (!parsed) return null;
  const title = titleReliable ? exactValue(track.title) : parsed.title;
  const artist = artistReliable ? exactValue(track.artist) : parsed.artist;
  if (!title || !artist) return null;
  const folderAlbum = fileContext?.folderName && reliableMetadata(fileContext.folderName)
    ? exactValue(fileContext.folderName)
    : '';
  return {
    title,
    artist,
    album: albumReliable ? exactValue(track.album) : folderAlbum,
    usedFileContext: true,
    fileContext
  };
}

function matchingTrack(track: Track, identity: SearchIdentity): Track {
  return {
    ...track,
    title: identity.title,
    artist: identity.artist,
    album: identity.album,
    albumArtist: reliableMetadata(track.albumArtist) ? track.albumArtist : identity.artist
  };
}

function albumGroupKey(track: Track, fileContext: SafeFileContext | null) {
  const albumSource = reliableMetadata(track.album)
    ? track.album
    : fileContext?.folderName ?? '';
  const artistSource = reliableMetadata(track.albumArtist)
    ? track.albumArtist
    : track.artist;
  const album = normalizedValue(albumSource);
  const artist = normalizedValue(artistSource);
  return album && artist ? `${artist}\u0000${album}` : '';
}

function confidenceFor(
  match: RankedCandidate,
  margin: number,
  humanOverride: boolean,
  usedFileContext: boolean
): LibraryAssistantConfidenceBand | null {
  if (match.blockingConflict || match.score < 55) return null;
  if (humanOverride || usedFileContext) return 'low';
  if (match.score >= 88 && margin >= HIGH_MARGIN) return 'high';
  if (match.score >= 68 && margin >= 8) return 'medium';
  return 'low';
}

type QueryTerms = { title: string; artist: string };

function queryText(terms: QueryTerms) {
  return [
    `recording:${JSON.stringify(exactValue(terms.title))}`,
    `artist:${JSON.stringify(exactValue(terms.artist))}`
  ].join(' AND ');
}

function cacheKey(terms: QueryTerms) {
  return JSON.stringify({
    title: normalizedValue(terms.title),
    artist: normalizedValue(terms.artist)
  });
}

async function fetchCandidates(
  terms: QueryTerms,
  providers: LibraryAssistantProviderGateway,
  fetchImpl: FetchLike,
  userAgent: string,
  signal?: AbortSignal
) {
  const url = new URL(`${MUSICBRAINZ_BASE_URL}/recording`);
  url.searchParams.set('query', queryText(terms));
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', String(MAX_CANDIDATES));

  const result = await providers.query({
    provider: { source: 'musicbrainz', version: MUSICBRAINZ_PROVIDER_VERSION, userAgent },
    cacheKey: cacheKey(terms),
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

function rankCandidates(track: Track, candidates: MusicBrainzRecordingCandidate[]) {
  return candidates
    .map(candidate => rankMusicBrainzCandidate(track, candidate))
    .sort((left, right) => {
      if (left.blockingConflict !== right.blockingConflict) return left.blockingConflict ? 1 : -1;
      return right.score - left.score;
    })
    .slice(0, MAX_CANDIDATES);
}

function artworkCurrentValue(track: Track) {
  return track.hasCover ? track.coverVersion ?? 'physical' : '';
}

function artworkLabel(values: Record<LibraryAssistantMetadataField, string>, release: MusicBrainzRelease) {
  const album = values.album || release.title;
  return album ? `Capa frontal — ${album}` : 'Capa frontal do álbum';
}

export function createMusicBrainzMetadataAnalyzer(options: AnalyzerOptions = {}): LibraryAssistantAnalyzer {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? MUSICBRAINZ_USER_AGENT;

  return {
    id: `musicbrainz-metadata-${MUSICBRAINZ_PROVIDER_VERSION}`,
    capability: 'metadata',
    async analyze({ tracks, signal, providers }) {
      const matches: TrackMatch[] = [];
      for (const track of tracks) {
        if (signal?.aborted) break;
        const fileContext = safeFileContext(options.getFileContext?.(track.id));
        const identity = searchIdentity(track, fileContext);
        if (!identity) continue;
        const matchTrack = matchingTrack(track, identity);
        const candidates = await fetchCandidates(
          { title: identity.title, artist: identity.artist },
          providers,
          fetchImpl,
          userAgent,
          signal
        );
        matches.push({
          track,
          matchTrack,
          usedFileContext: identity.usedFileContext,
          fileContext: identity.fileContext,
          ranked: rankCandidates(matchTrack, candidates)
        });
      }

      const albumContext = new Map<string, Map<string, number>>();
      const groupSizes = new Map<string, number>();
      for (const match of matches) {
        const key = albumGroupKey(match.matchTrack, match.fileContext);
        if (!key) continue;
        groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
        const best = match.ranked.find(candidate => !candidate.blockingConflict);
        const releaseId = best?.release?.id;
        if (!releaseId) continue;
        const releases = albumContext.get(key) ?? new Map<string, number>();
        releases.set(releaseId, (releases.get(releaseId) ?? 0) + 1);
        albumContext.set(key, releases);
      }

      const drafts: LibraryAssistantSuggestionDraft[] = [];
      for (const match of matches) {
        const plausible = match.ranked.filter(candidate => !candidate.blockingConflict);
        const best = plausible[0] ?? match.ranked[0];
        if (!best) continue;
        const second = plausible[1];
        let margin = second ? best.score - second.score : 100;
        const reasonCodes = new Set(best.reasonCodes);
        const evidence = [...best.evidence];

        if (match.usedFileContext && match.fileContext) {
          reasonCodes.add('metadata-missing');
          evidence.push({
            type: 'file-context',
            version: LIBRARY_ASSISTANT_CONTRACT_VERSION,
            fileName: match.fileContext.fileName,
            folderName: match.fileContext.folderName
          });
        }

        const key = albumGroupKey(match.matchTrack, match.fileContext);
        const releaseId = best.release?.id;
        if (!best.blockingConflict && key && releaseId) {
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
        const humanFields = new Set(options.getHumanOverrideFields?.(match.track.id) ?? []);
        const artworkConfidence = confidenceFor(best, margin, false, match.usedFileContext);
        if (!match.track.hasCover && artworkConfidence === 'high' && best.release) {
          try {
            const artwork = await findCoverArtArchiveFrontCover({
              releaseId: best.release.id,
              providers,
              fetchImpl,
              userAgent,
              signal
            });
            if (artwork) {
              const artworkReasonCodes = new Set(reasonCodes);
              artworkReasonCodes.add('artwork-missing');
              artworkReasonCodes.add('strong-external-id');
              drafts.push({
                capability: 'artwork',
                confidence: 'high',
                reasonCodes: [...artworkReasonCodes],
                evidence,
                provenance: {
                  source: 'cover-art-archive',
                  providerVersion: COVER_ART_ARCHIVE_PROVIDER_VERSION,
                  externalId: best.release.id
                },
                target: {
                  capability: 'artwork',
                  trackId: match.track.id,
                  candidateId: `cover-art-archive:${best.release.id}:${artwork.id}`,
                  label: artworkLabel(values, best.release),
                  sourceUrl: artwork.imageUrl,
                  thumbnailUrl: artwork.thumbnailUrl,
                  currentHasCover: Boolean(match.track.hasCover),
                  currentCoverVersion: artworkCurrentValue(match.track) || null,
                  musicBrainzReleaseId: best.release.id,
                  musicBrainzReleaseGroupId: best.release.releaseGroupId
                }
              });
            }
          } catch {
            // A capa é enriquecimento derivado da identificação confiável do MusicBrainz.
            // Falhas do CAA não devem bloquear sugestões de metadata da mesma análise.
          }
        }

        for (const field of ['title', 'artist', 'album', 'albumArtist'] as const) {
          const suggestedValue = values[field].trim();
          if (!suggestedValue || exactValue(match.track[field]) === exactValue(suggestedValue)) continue;
          const humanOverride = humanFields.has(field);
          const confidence = confidenceFor(best, margin, humanOverride, match.usedFileContext);
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
              trackId: match.track.id,
              field,
              currentValue: match.track[field],
              suggestedValue
            }
          });
        }
      }
      return drafts;
    }
  };
}
