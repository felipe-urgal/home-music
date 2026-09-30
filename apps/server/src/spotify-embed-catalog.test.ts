import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSpotifyCatalogUrl,
  parseSpotifyEmbedDocument
} from './spotify-embed-catalog.js';

function html(entity: unknown) {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { state: { data: { entity } } } }
  })}</script></body></html>`;
}

test('parseSpotifyCatalogUrl aceita track, album, playlist e prefixo intl', () => {
  assert.deepEqual(
    parseSpotifyCatalogUrl('https://open.spotify.com/intl-pt/playlist/3cEYpjA9oz9GiPac4AsH4n?si=abc'),
    {
      type: 'playlist',
      id: '3cEYpjA9oz9GiPac4AsH4n',
      canonicalUrl: 'https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n',
      embedUrl: 'https://open.spotify.com/embed/playlist/3cEYpjA9oz9GiPac4AsH4n'
    }
  );
  assert.equal(parseSpotifyCatalogUrl('https://example.com/playlist/3cEYpjA9oz9GiPac4AsH4n'), null);
});

test('parseSpotifyEmbedDocument normaliza playlist pública', () => {
  const source = parseSpotifyCatalogUrl('https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n')!;
  const parsed = parseSpotifyEmbedDocument(html({
    type: 'playlist',
    name: 'Minha playlist',
    subtitle: 'Felipe',
    coverArt: { sources: [{ url: 'https://image-cdn.spotifycdn.com/cover.jpg' }] },
    trackList: [
      {
        uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
        title: 'Never Gonna Give You Up',
        subtitle: 'Rick Astley',
        duration: 213573
      },
      {
        uri: 'spotify:track:11dFghVXANMlKmJXsNCbNl',
        title: 'Cut To The Feeling',
        subtitle: 'Carly Rae Jepsen',
        duration: 207959
      }
    ]
  }), source);

  assert.equal(parsed.label, 'Minha playlist');
  assert.equal(parsed.owner, 'Felipe');
  assert.equal(parsed.tracks.length, 2);
  assert.deepEqual(parsed.tracks[0], {
    id: '4uLU6hMCjMI75M1A2tKUQC',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    album: null,
    durationSeconds: 213.573,
    thumbnailUrl: 'https://image-cdn.spotifycdn.com/cover.jpg',
    spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
  });
});

test('parseSpotifyEmbedDocument usa a própria entidade para faixa individual', () => {
  const source = parseSpotifyCatalogUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')!;
  const parsed = parseSpotifyEmbedDocument(html({
    type: 'track',
    uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    name: 'Never Gonna Give You Up',
    subtitle: 'Rick Astley',
    duration: 213573
  }), source);

  assert.equal(parsed.type, 'track');
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].artist, 'Rick Astley');
});
