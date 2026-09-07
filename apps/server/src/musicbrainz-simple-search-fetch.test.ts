import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicBrainzSimpleSearchFetch } from './musicbrainz-simple-search-fetch.js';

test('remove filtro de release apenas da busca de recording do MusicBrainz', async () => {
  const seen: URL[] = [];
  const fetchImpl = createMusicBrainzSimpleSearchFetch(async input => {
    seen.push(new URL(String(input)));
    return new Response('{}', { status: 200 });
  });

  const url = new URL('https://musicbrainz.org/ws/2/recording');
  url.searchParams.set(
    'query',
    'recording:"Como Nossos Pais" AND artist:"Elis Regina" AND release:"Falso Brilhante"'
  );
  url.searchParams.set('fmt', 'json');

  await fetchImpl(url);

  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].searchParams.get('query'),
    'recording:"Como Nossos Pais" AND artist:"Elis Regina"'
  );
  assert.equal(seen[0].searchParams.get('fmt'), 'json');
});

test('preserva outros endpoints e buscas que já são simples', async () => {
  const seen: string[] = [];
  const fetchImpl = createMusicBrainzSimpleSearchFetch(async input => {
    seen.push(String(input));
    return new Response('{}', { status: 200 });
  });

  const simple = new URL('https://musicbrainz.org/ws/2/recording');
  simple.searchParams.set('query', 'recording:"Cancao" AND artist:"Artista"');
  await fetchImpl(simple);
  await fetchImpl('https://example.com/ws/2/recording?query=release%3A%22Album%22');

  assert.equal(
    new URL(seen[0]).searchParams.get('query'),
    'recording:"Cancao" AND artist:"Artista"'
  );
  assert.equal(seen[1], 'https://example.com/ws/2/recording?query=release%3A%22Album%22');
});
