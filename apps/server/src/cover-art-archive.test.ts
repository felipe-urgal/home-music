import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadCoverArtArchiveImage,
  normalizeCoverArtArchiveImageUrl,
  normalizeCoverArtArchiveRelease
} from './cover-art-archive.js';
import { CoverOverrideValidationError } from './track-cover-overrides.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('normaliza somente URLs do Cover Art Archive/Archive.org', () => {
  assert.equal(
    normalizeCoverArtArchiveImageUrl('http://coverartarchive.org/release/abc/front'),
    'https://coverartarchive.org/release/abc/front'
  );
  assert.equal(
    normalizeCoverArtArchiveImageUrl('https://ia800100.us.archive.org/1/items/mbid/front.jpg#fragment'),
    'https://ia800100.us.archive.org/1/items/mbid/front.jpg'
  );
  assert.equal(normalizeCoverArtArchiveImageUrl('https://example.com/front.jpg'), null);
  assert.equal(normalizeCoverArtArchiveImageUrl('file:///etc/passwd'), null);
});

test('extrai a primeira capa frontal válida do payload do CAA', () => {
  const cover = normalizeCoverArtArchiveRelease({
    images: [
      { front: false, image: 'https://coverartarchive.org/release/a/back' },
      {
        id: 'front-1',
        front: true,
        image: 'https://coverartarchive.org/release/a/front',
        thumbnails: {
          small: 'https://coverartarchive.org/release/a/small',
          500: 'https://coverartarchive.org/release/a/500'
        }
      }
    ]
  });

  assert.equal(cover?.id, 'front-1');
  assert.equal(cover?.imageUrl, 'https://coverartarchive.org/release/a/front');
  assert.equal(cover?.thumbnailUrl, 'https://coverartarchive.org/release/a/500');
});

test('download de capa segue apenas redirects permitidos e preserva bytes para validação central', async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = input.toString();
    calls.push(url);
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://ia800100.us.archive.org/1/items/front/front.png' }
      });
    }
    return new Response(PNG_1X1, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(PNG_1X1.byteLength)
      }
    });
  };

  const result = await downloadCoverArtArchiveImage(
    'https://coverartarchive.org/release/a/front',
    { fetchImpl }
  );

  assert.deepEqual(calls, [
    'https://coverartarchive.org/release/a/front',
    'https://ia800100.us.archive.org/1/items/front/front.png'
  ]);
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.finalUrl, 'https://ia800100.us.archive.org/1/items/front/front.png');
  assert.deepEqual(result.data, PNG_1X1);
});

test('download de capa bloqueia redirect para host não permitido', async () => {
  const fetchImpl = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://example.com/front.png' }
  });

  await assert.rejects(
    downloadCoverArtArchiveImage('https://coverartarchive.org/release/a/front', { fetchImpl }),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 400
  );
});