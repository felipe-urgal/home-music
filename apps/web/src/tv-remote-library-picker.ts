import type { Track } from '@home-music/shared';

export const TV_REMOTE_RESULT_LIMIT = 40;

function searchable(value: string) {
  return value.trim().toLocaleLowerCase('pt-BR');
}

export function filterTvRemoteTracks(tracks: Track[], query: string): Track[] {
  const normalizedQuery = searchable(query);
  const matches = normalizedQuery
    ? tracks.filter(track => [track.title, track.artist, track.album, track.albumArtist]
      .some(value => searchable(value).includes(normalizedQuery)))
    : tracks;
  return matches.slice(0, TV_REMOTE_RESULT_LIMIT);
}
