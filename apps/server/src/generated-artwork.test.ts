import assert from 'node:assert/strict';
import test from 'node:test';
import { ARTWORK_FALLBACK_VERSION, buildArtworkFallback } from '@home-music/shared/artwork';
import { renderGeneratedArtworkPng } from './generated-artwork.js';
import { inspectCoverOverride } from './track-cover-overrides.js';

const baseTrack = {
  id: 'track-a',
  title: 'Águas de Março',
  artist: 'Elis Regina',
  album: 'Elis & Tom',
  albumArtist: 'Elis Regina & Tom Jobim'
};

test('materialização usa a mesma identidade versionada do fallback da UI', () => {
  const expected = buildArtworkFallback(baseTrack);
  const generated = renderGeneratedArtworkPng(baseTrack, 128);

  assert.deepEqual(generated.identity, expected);
  assert.equal(generated.generatorVersion, ARTWORK_FALLBACK_VERSION);
  const inspected = inspectCoverOverride(generated.data, generated.contentType);
  assert.equal(inspected.contentType, 'image/png');
  assert.equal(inspected.width, 128);
  assert.equal(inspected.height, 128);
});

test('materialização é determinística, idempotente e Unicode-safe', () => {
  const unicodeTrack = {
    ...baseTrack,
    id: 'unicode',
    album: 'Álbum desconhecido',
    albumArtist: 'Artista desconhecido',
    artist: 'Artista desconhecido',
    title: 'É Tudo Muito Longo 🎧 com acentos e símbolos'
  };
  const first = renderGeneratedArtworkPng(unicodeTrack, 96);
  const second = renderGeneratedArtworkPng(unicodeTrack, 96);

  assert.deepEqual(first.data, second.data);
  assert.equal(first.identity.label, 'ÉT');
  assert.equal(
    inspectCoverOverride(first.data, first.contentType).version,
    inspectCoverOverride(second.data, second.contentType).version
  );
});

test('mesmo álbum preserva identidade e bytes materializados', () => {
  const first = renderGeneratedArtworkPng({ ...baseTrack, id: '1', title: 'Águas de Março' }, 96);
  const second = renderGeneratedArtworkPng({ ...baseTrack, id: '2', title: 'Corcovado' }, 96);

  assert.deepEqual(first.identity, second.identity);
  assert.deepEqual(first.data, second.data);
});
