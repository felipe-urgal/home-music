import assert from 'node:assert/strict';
import test from 'node:test';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import {
  downloadCoverArtArchiveImage,
  downloadTrustedArtworkImage,
  findCoverArtArchiveFrontCover,
  findCoverArtArchiveReleaseGroupFrontCover,
  normalizeCoverArtArchiveImageUrl,
  normalizeTrustedArtworkImageUrl,
  normalizeCoverArtArchiveRelease
} from './cover-art-archive.js';
import { CoverOverrideValidationError } from './track-cover-overrides.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function providers() {
  return {
    async query(query: any) {
      const raw = await query.execute({
        signal: new AbortController().signal,
        userAgent: 'HomeMusic/Test'
      });
      return { value: query.normalize(raw), cache: 'miss' };
    }
  } as unknown as LibraryAssistantProviderGateway;
}

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

test('normaliza artwork externo somente de CDN confiável', () => {
  assert.equal(
    normalizeTrustedArtworkImageUrl('http://is1-ssl.mzstatic.com/image/thumb/Music/test/100x100bb.jpg#x'),
    'https://is1-ssl.mzstatic.com/image/thumb/Music/test/100x100bb.jpg'
  );
  assert.equal(normalizeTrustedArtworkImageUrl('https://evil.example/front.jpg'), null);
});

test('download confiável aceita mzstatic e bloqueia redirect para host arbitrário', async () => {
  const downloaded = await downloadTrustedArtworkImage(
    'https://is1-ssl.mzstatic.com/image/thumb/Music/test/1200x1200bb.jpg',
    {
      fetchImpl: async () => new Response(new Uint8Array(PNG_1X1), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(PNG_1X1.byteLength)
        }
      })
    }
  );
  assert.equal(downloaded.contentType, 'image/png');
  assert.deepEqual(downloaded.data, PNG_1X1);

  await assert.rejects(
    downloadTrustedArtworkImage(
      'https://is1-ssl.mzstatic.com/image/thumb/Music/test/1200x1200bb.jpg',
      {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/front.png' }
        })
      }
    ),
    (error: unknown) => error instanceof CoverOverrideValidationError && error.statusCode === 400
  );
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

test('lookup de release-group segue redirect permitido até o JSON do Archive.org', async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    calls.push(url);
    assert.equal(init?.redirect, 'manual');

    if (calls.length === 1) {
      return new Response(null, {
        status: 307,
        headers: { location: 'https://archive.org/download/mbid-release/index.json' }
      });
    }
    return new Response(JSON.stringify({
      images: [{
        id: 'front-1',
        front: true,
        image: 'https://coverartarchive.org/release/release-1/front.jpg',
        thumbnails: {}
      }]
    }), { status: 200 });
  };

  const cover = await findCoverArtArchiveReleaseGroupFrontCover({
    releaseGroupId: 'group-1',
    providers: providers(),
    fetchImpl
  });

  assert.equal(cover?.id, 'front-1');
  assert.deepEqual(calls, [
    'https://coverartarchive.org/release-group/group-1',
    'https://archive.org/download/mbid-release/index.json'
  ]);
});

test('lookup de release segue redirect permitido até o JSON do Archive.org', async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = input.toString();
    calls.push(url);
    if (calls.length === 1) {
      return new Response(null, {
        status: 307,
        headers: { location: 'https://dn.example.archive.org/0/items/mbid-release/index.json' }
      });
    }
    return new Response(JSON.stringify({
      images: [{
        id: 'front-2',
        front: true,
        image: 'https://coverartarchive.org/release/release-1/front.jpg',
        thumbnails: {}
      }]
    }), { status: 200 });
  };

  const cover = await findCoverArtArchiveFrontCover({
    releaseId: 'release-1',
    providers: providers(),
    fetchImpl
  });

  assert.equal(cover?.id, 'front-2');
  assert.equal(calls.length, 2);
});

test('lookup de artwork bloqueia redirect externo ou sem Location', async () => {
  for (const location of ['https://example.com/index.json', null]) {
    const fetchImpl = async () => new Response(null, {
      status: 307,
      headers: location ? { location } : undefined
    });

    await assert.rejects(
      findCoverArtArchiveReleaseGroupFrontCover({
        releaseGroupId: 'group-1',
        providers: providers(),
        fetchImpl
      }),
      (error: unknown) => (
        error instanceof Error
        && (error as Error & { code?: string }).code === 'provider-request-failed'
      )
    );
  }
});

test('lookup de artwork limita cadeias de redirects', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, {
      status: 307,
      headers: { location: 'https://archive.org/download/mbid-release/index.json' }
    });
  };

  await assert.rejects(
    findCoverArtArchiveReleaseGroupFrontCover({
      releaseGroupId: 'group-1',
      providers: providers(),
      fetchImpl
    }),
    /excedeu o limite de redirects/
  );
  assert.equal(calls, 5);
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
    return new Response(new Uint8Array(PNG_1X1), {
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