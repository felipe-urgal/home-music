import type { AdminTrackCoverCandidate, AdminTrackMetadataSuggestion, ImportMetadataEnrichment, Track } from '@home-music/shared';
import {
  LIBRARY_ASSISTANT_CONTRACT_VERSION,
  type LibraryAssistantConfidenceBand,
  type LibraryAssistantEvidence,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReasonCode
} from '@home-music/shared/library-assistant';
import {
  COVER_ART_ARCHIVE_PROVIDER_VERSION,
  findCoverArtArchiveFrontCover,
  findCoverArtArchiveReleaseGroupFrontCover,
  normalizeTrustedArtworkImageUrl
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
const ITUNES_SEARCH_BASE_URL = 'https://itunes.apple.com/search';
const ITUNES_SEARCH_PROVIDER_VERSION = 'itunes-song-artwork-v1';
const ITUNES_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const ITUNES_SEARCH_MAX_RESPONSE_CHARS = 1_000_000;
const ITUNES_SEARCH_COUNTRIES = ['BR', 'US'] as const;
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
  useAlbumFilter: boolean;
  usedFileContext: boolean;
  usedTitleIdentity: boolean;
  fileContext: SafeFileContext | null;
};

type TrackMatch = {
  track: Track;
  matchTrack: Track;
  usedFileContext: boolean;
  usedTitleIdentity: boolean;
  fileContext: SafeFileContext | null;
  ranked: RankedCandidate[];
};

type AnalyzerOptions = {
  fetchImpl?: FetchLike;
  userAgent?: string;
  includeArtwork?: boolean;
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

export function needsMusicBrainzEnrichment(track: Track) {
  return !track.hasCover
    || !reliableMetadata(track.title)
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

function parseArtistTitle(value: string) {
  const clean = safeText(value);
  if (!clean) return null;
  const separators = [' - ', ' – ', ' — '] as const;
  for (const separator of separators) {
    const first = clean.indexOf(separator);
    if (first <= 0 || first !== clean.lastIndexOf(separator)) continue;
    const artist = safeText(clean.slice(0, first));
    const title = safeText(clean.slice(first + separator.length));
    if (artist && title) return { artist, title };
  }
  return null;
}

function parseArtistTitleFromFile(fileName: string) {
  return parseArtistTitle(fileStem(fileName));
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
      useAlbumFilter: albumReliable,
      usedFileContext: false,
      usedTitleIdentity: false,
      fileContext
    };
  }

  // Bibliotecas antigas e downloads frequentemente chegam como
  // "Artista - Faixa" dentro do próprio campo de título enquanto artist/album
  // ficam como placeholders. Quando o artista está ausente, essa estrutura é
  // mais útil para identificação do que pesquisar o título combinado inteiro.
  const parsedTitle = !artistReliable && titleReliable
    ? parseArtistTitle(track.title)
    : null;
  const parsedFile = fileContext ? parseArtistTitleFromFile(fileContext.fileName) : null;
  const parsed = parsedTitle ?? parsedFile;
  if (!parsed) return null;

  const title = parsedTitle
    ? parsedTitle.title
    : titleReliable
      ? exactValue(track.title)
      : parsed.title;
  const artist = artistReliable ? exactValue(track.artist) : parsed.artist;
  if (!title || !artist) return null;

  // Pasta pode ser gênero/coleção. Só usamos folderName como pista de álbum
  // no fallback de filename; um título combinado já fornece identidade
  // suficiente e não deve perder score por um nome de pasta não relacionado.
  const folderAlbum = !parsedTitle && fileContext?.folderName && reliableMetadata(fileContext.folderName)
    ? exactValue(fileContext.folderName)
    : '';
  return {
    title,
    artist,
    album: albumReliable ? exactValue(track.album) : folderAlbum,
    useAlbumFilter: albumReliable,
    usedFileContext: !parsedTitle && Boolean(parsedFile),
    usedTitleIdentity: Boolean(parsedTitle),
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

function textMatch(
  match: RankedCandidate,
  field: LibraryAssistantMetadataField
) {
  for (const item of match.evidence) {
    if (item.type === 'text-match' && item.field === field) return item.match;
  }
  return null;
}

function artworkConfidenceFor(
  match: RankedCandidate
): LibraryAssistantConfidenceBand | null {
  if (!match.release) return null;

  const titleMatch = textMatch(match, 'title');
  const artistMatch = textMatch(match, 'artist');

  // Artwork é best-effort: se título + artista batem de forma exata ou
  // normalizada, qualquer release oficial dessa gravação já é uma capa
  // coerente o bastante. Álbum, duração, edição e margem entre candidatos
  // continuam úteis para metadata, mas não bloqueiam a capa.
  const titleMatches = titleMatch != null && titleMatch !== 'different';
  const artistMatches = artistMatch != null && artistMatch !== 'different';
  return titleMatches && artistMatches ? 'high' : null;
}

type QueryTerms = { title: string; artist?: string; album?: string };

function queryText(terms: QueryTerms) {
  const query = [`recording:${JSON.stringify(exactValue(terms.title))}`];
  if (terms.artist) query.push(`artist:${JSON.stringify(exactValue(terms.artist))}`);
  if (terms.album) query.push(`release:${JSON.stringify(exactValue(terms.album))}`);
  return query.join(' AND ');
}

function cacheKey(terms: QueryTerms) {
  return JSON.stringify({
    title: normalizedValue(terms.title),
    artist: terms.artist ? normalizedValue(terms.artist) : null,
    album: terms.album ? normalizedValue(terms.album) : null
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

async function findArtworkForRelease(
  release: MusicBrainzRelease,
  options: {
    providers: LibraryAssistantProviderGateway;
    fetchImpl: FetchLike;
    userAgent: string;
    signal?: AbortSignal;
  }
) {
  const releaseArtwork = await findCoverArtArchiveFrontCover({
    releaseId: release.id,
    ...options
  });
  if (releaseArtwork) return releaseArtwork;

  if (!release.releaseGroupId) return null;
  return findCoverArtArchiveReleaseGroupFrontCover({
    releaseGroupId: release.releaseGroupId,
    ...options
  });
}

type ManualArtworkRankedCandidate = {
  candidate: MusicBrainzRecordingCandidate;
  score: number;
  artistDifferent: boolean;
};

type ITunesArtworkCandidate = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  durationSeconds: number | null;
  sourceUrl: string;
  thumbnailUrl: string;
};

function manualComparable(value: string) {
  return normalizedValue(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function manualTitleAffinity(sourceTitle: string, candidateTitle: string) {
  const source = manualComparable(sourceTitle);
  const candidate = manualComparable(candidateTitle);
  if (!source || !candidate) return null;
  if (source === candidate) return 100;

  const shorter = source.length <= candidate.length ? source : candidate;
  const longer = source.length <= candidate.length ? candidate : source;
  if (shorter.length < 5) return null;
  const phrase = ` ${longer} `;
  if (phrase.includes(` ${shorter} `)) return 76;
  return null;
}

function manualArtistAffinity(
  sourceArtist: string,
  candidateArtist: string,
  allowDifferent: boolean
) {
  if (!reliableMetadata(sourceArtist)) return { score: 0, different: false };

  const source = manualComparable(sourceArtist);
  const candidate = manualComparable(candidateArtist);
  if (!source || !candidate) return allowDifferent ? { score: -32, different: true } : null;
  if (source === candidate) return { score: 40, different: false };

  const shorter = source.length <= candidate.length ? source : candidate;
  const longer = source.length <= candidate.length ? candidate : source;
  if (shorter.length >= 4 && ` ${longer} `.includes(` ${shorter} `)) {
    return { score: 28, different: false };
  }

  return allowDifferent ? { score: -32, different: true } : null;
}

const MANUAL_TITLE_CONTEXT_SUFFIX = /\s*[\[(](?=[^\])]{1,80}[\])]\s*$)[^\])]*(?:ao\s+vivo|live|ac[uú]stico|unplugged|remaster(?:ed)?|radio\s+edit|edit|vers[aã]o|mix|remix|mashup)[^\])]*[\])]\s*$/i;

function manualArtworkSearchTitles(title: string) {
  const primary = exactValue(title);
  const values = [primary];
  const seen = new Set([manualComparable(primary)]);

  const withoutContext = exactValue(primary.replace(MANUAL_TITLE_CONTEXT_SUFFIX, ''));
  const contextKey = manualComparable(withoutContext);
  if (contextKey && contextKey.length >= 4 && !seen.has(contextKey)) {
    seen.add(contextKey);
    values.push(withoutContext);
  }

  for (const rawPart of primary.split(/\s*(?:,|\/|;|\|)\s*|\s+\+\s+/)) {
    const part = exactValue(rawPart);
    const key = manualComparable(part);
    if (!key || key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    values.push(part);
    if (values.length >= 6) break;
  }

  return values;
}

function rankManualArtworkCandidates(
  track: Track,
  candidates: MusicBrainzRecordingCandidate[],
  searchTitle: string,
  options: { allowDifferentArtist?: boolean } = {}
): ManualArtworkRankedCandidate[] {
  return candidates
    .flatMap(candidate => {
      const artistAffinity = manualArtistAffinity(
        track.artist,
        candidate.artist,
        options.allowDifferentArtist === true
      );
      if (!artistAffinity) return [];

      const titleAffinity = manualTitleAffinity(searchTitle, candidate.title);
      if (titleAffinity == null) return [];

      let score = titleAffinity + artistAffinity.score;

      if (track.album.trim() && reliableMetadata(track.album) && candidate.releases.some(
        release => compareText(track.album, release.title) !== 'different'
      )) score += 18;

      if (track.duration != null && candidate.durationSeconds != null) {
        const delta = Math.abs(track.duration - candidate.durationSeconds);
        if (delta <= 2) score += 10;
        else if (delta <= 5) score += 6;
        else if (delta <= 15) score += 2;
        else score -= Math.min(12, Math.round(delta / 10));
      }

      return [{
        candidate,
        score,
        artistDifferent: artistAffinity.different
      }];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES);
}

function normalizeItunesArtworkUrl(value: unknown, size: 'source' | 'thumbnail') {
  const normalized = normalizeTrustedArtworkImageUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (host !== 'mzstatic.com' && !host.endsWith('.mzstatic.com')) return null;
  url.pathname = url.pathname.replace(
    /\/\d+x\d+(?:bb)?(?=\.[A-Za-z0-9]+$)/,
    size === 'source' ? '/1200x1200bb' : '/600x600bb'
  );
  return url.toString();
}

function normalizeItunesCandidate(value: unknown): ITunesArtworkCandidate | null {
  const item = record(value);
  if (!item) return null;

  const rawId = item.trackId;
  const id = typeof rawId === 'number' && Number.isSafeInteger(rawId)
    ? String(rawId)
    : safeText(rawId, 64);
  const title = safeText(item.trackName);
  const artist = safeText(item.artistName);
  const album = safeText(item.collectionName);
  const albumArtist = safeText(item.collectionArtistName) ?? artist;
  const thumbnailUrl = normalizeItunesArtworkUrl(item.artworkUrl100, 'thumbnail');
  const sourceUrl = normalizeItunesArtworkUrl(item.artworkUrl100, 'source');
  if (!id || !title || !artist || !album || !albumArtist || !thumbnailUrl || !sourceUrl) return null;

  const millis = typeof item.trackTimeMillis === 'number' && Number.isFinite(item.trackTimeMillis)
    ? item.trackTimeMillis
    : null;

  return {
    id,
    title,
    artist,
    album,
    albumArtist,
    durationSeconds: millis == null ? null : Math.round(millis / 100) / 10,
    sourceUrl,
    thumbnailUrl
  };
}

function normalizeCachedItunesCandidate(value: unknown): ITunesArtworkCandidate | null {
  const item = record(value);
  if (!item) return null;
  const id = safeText(item.id, 64);
  const title = safeText(item.title);
  const artist = safeText(item.artist);
  const album = safeText(item.album);
  const albumArtist = safeText(item.albumArtist);
  const sourceUrl = normalizeItunesArtworkUrl(item.sourceUrl, 'source');
  const thumbnailUrl = normalizeItunesArtworkUrl(item.thumbnailUrl, 'thumbnail');
  if (!id || !title || !artist || !album || !albumArtist || !sourceUrl || !thumbnailUrl) return null;

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

  return { id, title, artist, album, albumArtist, durationSeconds, sourceUrl, thumbnailUrl };
}

function normalizeItunesSearch(payload: unknown): ITunesArtworkCandidate[] {
  if (Array.isArray(payload)) {
    const cached = payload
      .slice(0, 20)
      .map(normalizeCachedItunesCandidate);
    if (cached.some(candidate => candidate == null)) throw new LibraryAssistantProviderResponseError();
    return cached as ITunesArtworkCandidate[];
  }

  const root = record(payload);
  if (!root || !Array.isArray(root.results) || root.results.length > 200) {
    throw new LibraryAssistantProviderResponseError();
  }
  return root.results
    .slice(0, 20)
    .map(normalizeItunesCandidate)
    .filter((value): value is ITunesArtworkCandidate => Boolean(value));
}

async function fetchItunesArtworkCandidates(
  terms: { title: string; artist?: string; country: string },
  providers: LibraryAssistantProviderGateway,
  fetchImpl: FetchLike,
  userAgent: string
) {
  const url = new URL(ITUNES_SEARCH_BASE_URL);
  url.searchParams.set('term', [terms.title, terms.artist].filter(Boolean).join(' '));
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '20');
  url.searchParams.set('country', terms.country);

  const result = await providers.query({
    provider: { source: 'itunes-search', version: ITUNES_SEARCH_PROVIDER_VERSION, userAgent },
    cacheKey: JSON.stringify({
      title: normalizedValue(terms.title),
      artist: terms.artist ? normalizedValue(terms.artist) : null,
      country: terms.country
    }),
    ttlMs: ITUNES_SEARCH_CACHE_TTL_MS,
    execute: async ({ signal, userAgent: providerUserAgent }) => {
      const response = await fetchImpl(url, {
        signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'User-Agent': providerUserAgent
        }
      });
      if (!response.ok) {
        const error = new Error(response.status === 429 || response.status === 503
          ? 'Catálogo iTunes temporariamente indisponível.'
          : 'Falha ao consultar catálogo iTunes.');
        Object.assign(error, {
          code: response.status === 429 || response.status === 503
            ? 'provider-rate-limited'
            : 'provider-request-failed',
          statusCode: response.status
        });
        throw error;
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > ITUNES_SEARCH_MAX_RESPONSE_CHARS) {
        throw new LibraryAssistantProviderResponseError();
      }
      const text = await response.text();
      if (text.length > ITUNES_SEARCH_MAX_RESPONSE_CHARS) {
        throw new LibraryAssistantProviderResponseError();
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new LibraryAssistantProviderResponseError();
      }
    },
    normalize: normalizeItunesSearch
  });
  return result.value;
}

function rankItunesArtworkCandidates(
  track: Track,
  candidates: ITunesArtworkCandidate[],
  searchTitle: string,
  options: { allowDifferentArtist?: boolean } = {}
) {
  return candidates
    .flatMap(candidate => {
      const titleAffinity = manualTitleAffinity(searchTitle, candidate.title);
      if (titleAffinity == null) return [];

      const artistAffinity = manualArtistAffinity(
        track.artist,
        candidate.artist,
        options.allowDifferentArtist === true || !reliableMetadata(track.artist)
      );
      if (!artistAffinity) return [];
      let score = titleAffinity + artistAffinity.score;

      if (reliableMetadata(track.album) && compareText(track.album, candidate.album) !== 'different') {
        score += 18;
      }
      if (track.duration != null && candidate.durationSeconds != null) {
        const delta = Math.abs(track.duration - candidate.durationSeconds);
        if (delta <= 2) score += 10;
        else if (delta <= 5) score += 6;
        else if (delta <= 15) score += 2;
        else score -= Math.min(12, Math.round(delta / 10));
      }

      return [{ candidate, score, artistDifferent: artistAffinity.different }];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
}

async function findItunesArtworkFallback(
  track: Track,
  searchTitles: readonly string[],
  providers: LibraryAssistantProviderGateway,
  fetchImpl: FetchLike,
  userAgent: string
): Promise<AdminTrackCoverCandidate[]> {
  const seen = new Set<string>();
  const results: AdminTrackCoverCandidate[] = [];
  const artist = reliableMetadata(track.artist) ? exactValue(track.artist) : '';

  for (const title of searchTitles.slice(0, 4)) {
    for (const country of ITUNES_SEARCH_COUNTRIES) {
      let candidates: ITunesArtworkCandidate[];
      try {
        candidates = await fetchItunesArtworkCandidates(
          artist ? { title, artist, country } : { title, country },
          providers,
          fetchImpl,
          userAgent
        );
      } catch {
        continue;
      }
      const ranked = rankItunesArtworkCandidates(track, candidates, title);
      for (const rankedCandidate of ranked) {
        const candidate = rankedCandidate.candidate;
        const key = candidate.sourceUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          id: `itunes-search:${candidate.id}`,
          label: rankedCandidate.artistDifferent
            ? `Alternativa — ${candidate.artist} · ${candidate.album}`
            : `Capa — ${candidate.album}`,
          album: candidate.album,
          artist: candidate.artist,
          sourceUrl: candidate.sourceUrl,
          thumbnailUrl: candidate.thumbnailUrl,
          musicBrainzReleaseId: null,
          musicBrainzReleaseGroupId: null
        });
        if (results.length >= 8) return results;
      }
      if (results.length > 0) return results;
    }
  }

  return results;
}

export async function findTrackMetadataSuggestion(
  track: Track,
  providers: LibraryAssistantProviderGateway,
  options: Pick<AnalyzerOptions, 'fetchImpl' | 'userAgent' | 'getFileContext'> = {}
): Promise<AdminTrackMetadataSuggestion | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? MUSICBRAINZ_USER_AGENT;
  const fileContext = safeFileContext(options.getFileContext?.(track.id));
  const identity = searchIdentity(track, fileContext);
  const parsedFile = fileContext ? parseArtistTitleFromFile(fileContext.fileName) : null;

  const searchTitle = identity?.title
    ?? (reliableMetadata(track.title) ? exactValue(track.title) : parsedFile?.title ?? '');
  const searchArtist = identity?.artist
    ?? (reliableMetadata(track.artist) ? exactValue(track.artist) : parsedFile?.artist ?? '');
  if (!searchTitle) return null;

  const matchTrack = identity
    ? matchingTrack(track, identity)
    : {
        ...track,
        title: searchTitle,
        artist: searchArtist || track.artist
      };
  const searchTitles = manualArtworkSearchTitles(searchTitle);

  const fromMusicBrainz = async (
    title: string,
    artist: string | null,
    allowDifferentArtist: boolean
  ): Promise<AdminTrackMetadataSuggestion | null> => {
    const recordings = await fetchCandidates(
      artist ? { title, artist } : { title },
      providers,
      fetchImpl,
      userAgent
    );
    const ranked = rankManualArtworkCandidates(matchTrack, recordings, title, {
      allowDifferentArtist
    });
    for (const rankedCandidate of ranked) {
      const release = bestRelease(matchTrack, rankedCandidate.candidate)
        ?? rankedCandidate.candidate.releases[0]
        ?? null;
      if (!release) continue;
      return {
        source: 'musicbrainz',
        artist: rankedCandidate.candidate.artist,
        album: release.title,
        albumArtist: release.albumArtist ?? rankedCandidate.candidate.artist
      };
    }
    return null;
  };

  if (searchArtist) {
    for (const title of searchTitles) {
      const suggestion = await fromMusicBrainz(title, searchArtist, false);
      if (suggestion) return suggestion;
    }
  }

  for (const title of searchTitles) {
    const suggestion = await fromMusicBrainz(title, null, true);
    if (suggestion) return suggestion;
  }

  for (const title of searchTitles.slice(0, 4)) {
    for (const country of ITUNES_SEARCH_COUNTRIES) {
      const attempts = searchArtist
        ? [
            { artist: searchArtist, allowDifferentArtist: false },
            { artist: undefined, allowDifferentArtist: true }
          ]
        : [{ artist: undefined, allowDifferentArtist: true }];

      for (const attempt of attempts) {
        let candidates: ITunesArtworkCandidate[];
        try {
          candidates = await fetchItunesArtworkCandidates(
            attempt.artist
              ? { title, artist: attempt.artist, country }
              : { title, country },
            providers,
            fetchImpl,
            userAgent
          );
        } catch {
          continue;
        }

        const best = rankItunesArtworkCandidates(matchTrack, candidates, title, {
          allowDifferentArtist: attempt.allowDifferentArtist
        })[0];
        if (!best) continue;
        return {
          source: 'itunes-search',
          artist: best.candidate.artist,
          album: best.candidate.album,
          albumArtist: best.candidate.albumArtist
        };
      }
    }
  }

  return null;
}

export async function findMusicBrainzImportMetadataEnrichment(
  track: Track,
  providers: LibraryAssistantProviderGateway,
  options: Pick<AnalyzerOptions, 'fetchImpl' | 'userAgent' | 'getFileContext'> = {}
): Promise<ImportMetadataEnrichment> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? MUSICBRAINZ_USER_AGENT;
  const fileContext = safeFileContext(options.getFileContext?.(track.id));
  const identity = searchIdentity(track, fileContext);
  if (!identity) {
    return { source: 'musicbrainz', album: null, albumArtist: null, coverCandidates: [] };
  }

  const matchTrack = matchingTrack(track, identity);
  const searchTitles = manualArtworkSearchTitles(identity.title);
  let selected: {
    searchTitle: string;
    candidate: MusicBrainzRecordingCandidate;
    release: MusicBrainzRelease;
  } | null = null;

  for (let index = 0; index < searchTitles.length && !selected; index += 1) {
    const searchTitle = searchTitles[index];
    const scopedTerms = index === 0 && identity.useAlbumFilter
      ? { title: searchTitle, artist: identity.artist, album: identity.album }
      : null;
    let recordings = scopedTerms
      ? await fetchCandidates(scopedTerms, providers, fetchImpl, userAgent)
      : [];
    if (!scopedTerms || recordings.length === 0) {
      recordings = await fetchCandidates(
        { title: searchTitle, artist: identity.artist },
        providers,
        fetchImpl,
        userAgent
      );
    }

    const ranked = rankManualArtworkCandidates(matchTrack, recordings, searchTitle);
    for (const rankedCandidate of ranked) {
      const release = bestRelease(matchTrack, rankedCandidate.candidate)
        ?? rankedCandidate.candidate.releases[0]
        ?? null;
      if (!release) continue;
      selected = {
        searchTitle,
        candidate: rankedCandidate.candidate,
        release
      };
      break;
    }
  }

  if (!selected) {
    return { source: 'musicbrainz', album: null, albumArtist: null, coverCandidates: [] };
  }

  const albumArtist = selected.release.albumArtist ?? selected.candidate.artist;
  const artworkTrack: Track = {
    ...matchTrack,
    title: selected.searchTitle,
    album: selected.release.title,
    albumArtist
  };
  const coverCandidates = track.hasCover
    ? []
    : await findMusicBrainzArtworkCandidates(artworkTrack, providers, options);

  return {
    source: 'musicbrainz',
    album: selected.release.title,
    albumArtist,
    coverCandidates
  };
}

export async function findMusicBrainzArtworkCandidates(
  track: Track,
  providers: LibraryAssistantProviderGateway,
  options: Pick<AnalyzerOptions, 'fetchImpl' | 'userAgent' | 'getFileContext'> = {}
): Promise<AdminTrackCoverCandidate[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const userAgent = options.userAgent ?? MUSICBRAINZ_USER_AGENT;
  const fileContext = safeFileContext(options.getFileContext?.(track.id));
  const identity = searchIdentity(track, fileContext);
  const parsedFile = fileContext ? parseArtistTitleFromFile(fileContext.fileName) : null;

  const searchTitle = identity?.title
    ?? (reliableMetadata(track.title) ? exactValue(track.title) : parsedFile?.title ?? '');
  const searchArtist = identity?.artist
    ?? (reliableMetadata(track.artist) ? exactValue(track.artist) : parsedFile?.artist ?? '');
  if (!searchTitle) return [];

  const album = identity?.album
    ?? (reliableMetadata(track.album) ? exactValue(track.album) : '');
  const useAlbumFilter = Boolean(searchArtist && album && (identity?.useAlbumFilter ?? false));
  const matchTrack = identity
    ? matchingTrack(track, identity)
    : {
        ...track,
        title: searchTitle,
        artist: searchArtist || track.artist,
        album,
        albumArtist: reliableMetadata(track.albumArtist)
          ? track.albumArtist
          : searchArtist || track.albumArtist
      };

  const searchTitles = manualArtworkSearchTitles(searchTitle);
  const primaryTitle = searchTitles[0] ?? searchTitle;
  const scopedTerms = useAlbumFilter
    ? { title: primaryTitle, artist: searchArtist, album }
    : null;

  const seenReleases = new Set<string>();
  const seenArtwork = new Set<string>();
  const results: AdminTrackCoverCandidate[] = [];
  let artworkAttempts = 0;

  const collectArtwork = async (
    ranked: ManualArtworkRankedCandidate[],
    albumOnly: boolean
  ) => {
    const releaseCandidates: Array<{
      release: MusicBrainzRelease;
      artist: string;
      score: number;
      artistDifferent: boolean;
    }> = [];

    for (const rankedCandidate of ranked) {
      const releases = albumOnly
        ? rankedCandidate.candidate.releases.filter(
            release => album && compareText(album, release.title) !== 'different'
          )
        : rankedCandidate.candidate.releases;

      for (const release of releases) {
        releaseCandidates.push({
          release,
          artist: release.albumArtist ?? rankedCandidate.candidate.artist,
          score: rankedCandidate.score
            + (album && compareText(album, release.title) !== 'different' ? 18 : 0),
          artistDifferent: rankedCandidate.artistDifferent
        });
      }
    }

    releaseCandidates.sort((left, right) => right.score - left.score);

    for (const candidate of releaseCandidates) {
      if (results.length >= 8 || artworkAttempts >= 32) break;
      if (seenReleases.has(candidate.release.id)) continue;
      seenReleases.add(candidate.release.id);
      artworkAttempts += 1;

      try {
        const artwork = await findArtworkForRelease(candidate.release, {
          providers,
          fetchImpl,
          userAgent
        });
        if (!artwork) continue;

        const artworkKey = artwork.id || artwork.imageUrl;
        if (seenArtwork.has(artworkKey)) continue;
        seenArtwork.add(artworkKey);
        results.push({
          id: `cover-art-archive:${candidate.release.id}:${artwork.id}`,
          label: candidate.artistDifferent
            ? `Alternativa — ${candidate.artist} · ${candidate.release.title}`
            : `Capa frontal — ${candidate.release.title}`,
          album: candidate.release.title,
          artist: candidate.artist,
          sourceUrl: artwork.imageUrl,
          thumbnailUrl: artwork.thumbnailUrl,
          musicBrainzReleaseId: candidate.release.id,
          musicBrainzReleaseGroupId: candidate.release.releaseGroupId
        });
      } catch {
        // Uma edição sem artwork válido não impede mostrar outras capas encontradas.
      }
    }
  };

  let scopedRanked: ManualArtworkRankedCandidate[] = [];
  if (scopedTerms) {
    const scopedRecordings = await fetchCandidates(
      scopedTerms,
      providers,
      fetchImpl,
      userAgent
    );
    scopedRanked = rankManualArtworkCandidates(matchTrack, scopedRecordings, primaryTitle);
    await collectArtwork(scopedRanked, true);
    if (results.length > 0) return results;
  }

  if (searchArtist) {
    const broadRecordings = await fetchCandidates(
      { title: primaryTitle, artist: searchArtist },
      providers,
      fetchImpl,
      userAgent
    );
    const preferredRecordingIds = new Set(
      scopedRanked.map(candidate => candidate.candidate.recordingId)
    );
    const broadRanked = rankManualArtworkCandidates(matchTrack, broadRecordings, primaryTitle)
      .sort((left, right) => {
        const leftPreferred = preferredRecordingIds.has(left.candidate.recordingId) ? 1 : 0;
        const rightPreferred = preferredRecordingIds.has(right.candidate.recordingId) ? 1 : 0;
        return rightPreferred - leftPreferred || right.score - left.score;
      });

    await collectArtwork(broadRanked, false);
    if (results.length > 0) return results;

    for (const alternateTitle of searchTitles.slice(1)) {
      if (results.length >= 8 || artworkAttempts >= 32) break;
      const recordings = await fetchCandidates(
        { title: alternateTitle, artist: searchArtist },
        providers,
        fetchImpl,
        userAgent
      );
      const ranked = rankManualArtworkCandidates(matchTrack, recordings, alternateTitle);
      await collectArtwork(ranked, false);
      if (results.length > 0) return results;
    }
  }

  // Último fallback do MusicBrainz para uso estritamente manual: título sem
  // artista. Isso cobre arquivos sem artista e também permite mostrar uma
  // alternativa claramente rotulada quando o artista local estiver incorreto.
  for (const title of searchTitles) {
    if (results.length >= 8 || artworkAttempts >= 32) break;
    const recordings = await fetchCandidates(
      { title },
      providers,
      fetchImpl,
      userAgent
    );
    const ranked = rankManualArtworkCandidates(matchTrack, recordings, title, {
      allowDifferentArtist: true
    });
    await collectArtwork(ranked, false);
    if (results.length > 0) return results;
  }

  // Há catálogos legítimos sem artwork no MusicBrainz/CAA. Como último recurso
  // da busca manual, usamos o catálogo público do iTunes. Nada aqui entra no
  // fluxo automático da Assistente; o usuário ainda precisa escolher a capa.
  return findItunesArtworkFallback(
    matchTrack,
    searchTitles,
    providers,
    fetchImpl,
    userAgent
  );
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
        const scopedTerms = identity.useAlbumFilter
          ? { title: identity.title, artist: identity.artist, album: identity.album }
          : null;
        let candidates = scopedTerms
          ? await fetchCandidates(scopedTerms, providers, fetchImpl, userAgent, signal)
          : [];
        if (!scopedTerms || candidates.length === 0) {
          candidates = await fetchCandidates(
            { title: identity.title, artist: identity.artist },
            providers,
            fetchImpl,
            userAgent,
            signal
          );
        }
        matches.push({
          track,
          matchTrack,
          usedFileContext: identity.usedFileContext,
          usedTitleIdentity: identity.usedTitleIdentity,
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

        if (match.usedFileContext || match.usedTitleIdentity) {
          reasonCodes.add('metadata-missing');
        }
        if (match.usedFileContext && match.fileContext) {
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
        const artworkConfidence = artworkConfidenceFor(best);
        if (options.includeArtwork !== false && !match.track.hasCover && artworkConfidence === 'high' && best.release) {
          try {
            const artwork = await findArtworkForRelease(best.release, {
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
