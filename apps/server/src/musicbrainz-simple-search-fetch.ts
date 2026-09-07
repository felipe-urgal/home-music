type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const MUSICBRAINZ_ORIGIN = 'https://musicbrainz.org';
const MUSICBRAINZ_RECORDING_PATH = '/ws/2/recording';
const RELEASE_FILTER = /\s+AND\s+release:"(?:\\.|[^"\\])*"/gi;

function simplifiedMusicBrainzUrl(input: string | URL) {
  const url = new URL(String(input));
  if (url.origin !== MUSICBRAINZ_ORIGIN || url.pathname !== MUSICBRAINZ_RECORDING_PATH) return url;

  const query = url.searchParams.get('query');
  if (!query || !/\brelease:/i.test(query)) return url;

  const simplified = query.replace(RELEASE_FILTER, '').trim();
  if (simplified) url.searchParams.set('query', simplified);
  return url;
}

export function createMusicBrainzSimpleSearchFetch(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)
): FetchLike {
  return (input, init) => fetchImpl(simplifiedMusicBrainzUrl(input), init);
}
