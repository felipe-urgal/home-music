import assert from 'node:assert/strict';
import test from 'node:test';
import type { AdminExternalProviderSearchResponse } from '@home-music/shared';
import { YtDlpBatchInspector } from './yt-dlp-batch-inspector.js';

const spotifyTracks = [
  {
    id: '4uLU6hMCjMI75M1A2tKUQC',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    album: 'Whenever You Need Somebody',
    durationSeconds: 213,
    thumbnailUrl: 'https://i.scdn.co/image/cover',
    spotifyUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'
  },
  {
    id: '11dFghVXANMlKmJXsNCbNl',
    title: 'Cut To The Feeling',
    artist: 'Carly Rae Jepsen',
    album: 'Cut To The Feeling',
    durationSeconds: 208,
    thumbnailUrl: null,
    spotifyUrl: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl'
  }
] as const;

function result(
  query: string,
  items: AdminExternalProviderSearchResponse['items']
): AdminExternalProviderSearchResponse {
  return { query, items };
}

test('Spotify vira lote yt-dlp somente para matches confiáveis', async () => {
  const searches: string[] = [];
  const inspector = new YtDlpBatchInspector({
    commandPath: '/usr/bin/yt-dlp',
    maxItems: 50,
    spotifyCatalog: {
      async inspect() {
        return {
          type: 'playlist',
          id: '3cEYpjA9oz9GiPac4AsH4n',
          label: 'Favoritas',
          owner: 'Felipe',
          thumbnailUrl: null,
          spotifyUrl: 'https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n',
          tracks: spotifyTracks
        };
      }
    },
    search: {
      async search(query) {
        const normalizedQuery = String(query);
        searches.push(normalizedQuery);
        if (normalizedQuery.includes('Rick Astley')) {
          return result(normalizedQuery, [{
            id: 'dQw4w9WgXcQ',
            title: 'Rick Astley - Never Gonna Give You Up (Official Audio)',
            artist: 'Rick Astley',
            durationSeconds: 213,
            thumbnailUrl: null,
            sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            provider: 'yt-dlp'
          }]);
        }
        return result(normalizedQuery, [
          {
            id: 'candidate01',
            title: 'Cut To The Feeling',
            artist: 'Carly Rae Jepsen',
            durationSeconds: 208,
            thumbnailUrl: null,
            sourceUrl: 'https://www.youtube.com/watch?v=candidate01',
            provider: 'yt-dlp'
          },
          {
            id: 'candidate02',
            title: 'Cut To The Feeling',
            artist: 'Carly Rae Jepsen',
            durationSeconds: 209,
            thumbnailUrl: null,
            sourceUrl: 'https://www.youtube.com/watch?v=candidate02',
            provider: 'yt-dlp'
          }
        ]);
      }
    }
  });

  const batch = await inspector.inspect(
    { url: 'https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n' },
    new AbortController().signal
  );

  assert.equal(batch?.providerId, 'yt-dlp');
  assert.equal(batch?.label, 'Spotify · Favoritas');
  assert.equal(batch?.items.length, 2);
  assert.equal(searches.length, 2);

  assert.deepEqual(batch?.items[0].request, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provenance: {
      catalog: 'spotify',
      catalogId: '4uLU6hMCjMI75M1A2tKUQC',
      catalogUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      matchConfidence: 0.94
    },
    metadata: {
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      album: 'Whenever You Need Somebody',
      thumbnailUrl: 'https://i.scdn.co/image/cover',
      attribution: 'Spotify · catálogo · match 94%'
    }
  });

  assert.equal(batch?.items[0].candidates?.length, 1);
  assert.equal(batch?.items[1].request, null);
  assert.equal(batch?.items[1].candidates?.length, 2);
  assert.match(batch?.items[1].unavailableReason ?? '', /Correspondência ambígua/);
});

test('coleção Spotify acima do limite não dispara buscas por mídia', async () => {
  let searches = 0;
  const inspector = new YtDlpBatchInspector({
    commandPath: '/usr/bin/yt-dlp',
    maxItems: 1,
    spotifyCatalog: {
      async inspect() {
        return {
          type: 'playlist',
          id: '3cEYpjA9oz9GiPac4AsH4n',
          label: 'Grande',
          owner: null,
          thumbnailUrl: null,
          spotifyUrl: 'https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n',
          tracks: spotifyTracks
        };
      }
    },
    search: {
      async search(query) {
        searches += 1;
        return result(String(query), []);
      }
    }
  });

  const batch = await inspector.inspect(
    { url: 'https://open.spotify.com/playlist/3cEYpjA9oz9GiPac4AsH4n' },
    new AbortController().signal
  );

  assert.equal(batch?.items.length, 2);
  assert.equal(searches, 0);
  assert.match(batch?.items[0].unavailableReason ?? '', /limite de 1/);
});
