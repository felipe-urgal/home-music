import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminExternalProviderSearchItem } from '@home-music/shared';
import type { SpotifyCatalogTrack } from './spotify-embed-catalog.js';
import {
  scoreSpotifyMediaCandidate,
  selectSpotifyMediaMatch
} from './spotify-media-match.js';

const track: SpotifyCatalogTrack = {
  id: '4uLU6hMCjMI75M1A2tKUQC',
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  album: 'Whenever You Need Somebody',
  durationSeconds: 213,
  thumbnailUrl: null,
  spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
};

function candidate(id: string, title: string, artist: string, durationSeconds: number): AdminExternalProviderSearchItem {
  return {
    id,
    title,
    artist,
    durationSeconds,
    thumbnailUrl: null,
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    provider: 'yt-dlp'
  };
}

test('matching favorece título, artista e duração equivalentes', () => {
  const official = candidate('official1', 'Rick Astley - Never Gonna Give You Up (Official Audio)', 'Rick Astley', 213);
  const live = candidate('live0001', 'Rick Astley - Never Gonna Give You Up (Live)', 'Rick Astley', 235);

  assert.ok(scoreSpotifyMediaCandidate(track, official) > scoreSpotifyMediaCandidate(track, live));
  const selected = selectSpotifyMediaMatch(track, [live, official]);
  assert.equal(selected?.item.id, 'official1');
  assert.equal(selected?.automatic, true);
});

test('matching não automatiza resultado ambíguo', () => {
  const first = candidate('version1', 'Never Gonna Give You Up', 'Rick Astley', 213);
  const second = candidate('version2', 'Never Gonna Give You Up', 'Rick Astley', 214);
  const selected = selectSpotifyMediaMatch(track, [first, second]);
  assert.equal(selected?.automatic, false);
});
