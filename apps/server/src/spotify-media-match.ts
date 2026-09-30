import type { AdminExternalProviderSearchItem } from '@home-music/shared';
import type { SpotifyCatalogTrack } from './spotify-embed-catalog.js';

const VARIANT_TERMS = [
  'live',
  'ao vivo',
  'remix',
  'slowed',
  'reverb',
  'sped up',
  'nightcore',
  'karaoke',
  'cover',
  'instrumental',
  'acoustic',
  'acustico'
] as const;

export type SpotifyMediaMatch = Readonly<{
  item: AdminExternalProviderSearchItem;
  confidence: number;
  automatic: boolean;
}>;

function normalized(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string) {
  return new Set(normalized(value).split(' ').filter(token => token.length > 1));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.max(left.size, right.size);
}

function durationScore(expected: number | null, actual: number | null) {
  if (!expected || !actual) return 0.5;
  const difference = Math.abs(expected - actual);
  if (difference <= 2) return 1;
  if (difference <= 5) return 0.9;
  if (difference <= 10) return 0.72;
  if (difference <= 20) return 0.4;
  return 0;
}

function variantPenalty(expected: string, candidate: string) {
  let penalty = 0;
  for (const term of VARIANT_TERMS) {
    const wanted = expected.includes(term);
    const offered = candidate.includes(term);
    if (wanted !== offered) penalty += 0.12;
  }
  return Math.min(0.36, penalty);
}

export function scoreSpotifyMediaCandidate(
  track: SpotifyCatalogTrack,
  item: AdminExternalProviderSearchItem
) {
  const expectedTitle = normalized(track.title);
  const expectedArtist = normalized(track.artist);
  const candidateTitle = normalized(item.title);
  const candidateArtist = normalized(item.artist);
  const candidateCombined = normalized(`${item.artist ?? ''} ${item.title}`);
  const expectedCombined = normalized(`${track.artist} ${track.title}`);

  const titleOverlap = overlap(tokens(track.title), tokens(item.title));
  const artistTokens = tokens(track.artist);
  const artistOverlap = Math.max(
    overlap(artistTokens, tokens(item.artist ?? '')),
    overlap(artistTokens, tokens(item.title))
  );
  const exactTitle = expectedTitle === candidateTitle ? 1 : 0;
  const combinedContains = candidateCombined.includes(expectedTitle)
    && (expectedArtist.length === 0 || candidateCombined.includes(expectedArtist))
    ? 1
    : 0;

  const base = titleOverlap * 0.46
    + artistOverlap * 0.24
    + durationScore(track.durationSeconds, item.durationSeconds) * 0.18
    + exactTitle * 0.06
    + combinedContains * 0.06;

  const penalty = variantPenalty(expectedCombined, candidateCombined);
  return Math.max(0, Math.min(1, Number((base - penalty).toFixed(4))));
}

export function selectSpotifyMediaMatch(
  track: SpotifyCatalogTrack,
  items: readonly AdminExternalProviderSearchItem[]
): SpotifyMediaMatch | null {
  const ranked = items
    .map(item => ({ item, confidence: scoreSpotifyMediaCandidate(track, item) }))
    .sort((left, right) => right.confidence - left.confidence);

  const best = ranked[0];
  if (!best) return null;
  const runnerUp = ranked[1]?.confidence ?? 0;
  const automatic = best.confidence >= 0.78
    && (best.confidence - runnerUp >= 0.06 || best.confidence >= 0.92);

  return {
    item: best.item,
    confidence: best.confidence,
    automatic
  };
}
