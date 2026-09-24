import assert from 'node:assert/strict';
import test from 'node:test';
import type { YtDlpProcessRequest } from './yt-dlp-provider.js';
import { YtDlpSearch, normalizeYtDlpSearchQuery } from './yt-dlp-search.js';

function searchWith(payload: unknown) {
  const requests: YtDlpProcessRequest[] = [];
  let proxyClosed = false;
  const search = new YtDlpSearch({
    commandPath: '/usr/local/bin/yt-dlp',
    maxResults: 3,
    runner: async request => {
      requests.push(request);
      return { stdout: JSON.stringify(payload), stderr: '' };
    },
    createProxy: async () => ({
      url: 'http://127.0.0.1:45678',
      close: async () => { proxyClosed = true; }
    })
  });
  return { search, requests, proxyClosed: () => proxyClosed };
}

test('busca por texto usa ytsearch limitado, proxy seguro e não baixa mídia', async () => {
  const fixture = searchWith({
    _type: 'playlist',
    entries: [
      {
        id: 'abcDEF_1234',
        title: 'Samurai',
        uploader: 'Djavan',
        duration: 312,
        thumbnail: 'https://i.ytimg.com/vi/abcDEF_1234/hqdefault.jpg'
      },
      {
        id: 'xyzDEF_5678',
        track: 'Lilás',
        artist: 'Djavan',
        duration: '245',
        thumbnails: [{ url: 'https://i.ytimg.com/vi/xyzDEF_5678/default.jpg' }]
      }
    ]
  });

  const result = await fixture.search.search(
    '  Djavan   Samurai  ',
    new AbortController().signal
  );

  assert.equal(result.query, 'Djavan Samurai');
  assert.deepEqual(result.items, [
    {
      id: 'abcDEF_1234',
      title: 'Samurai',
      artist: 'Djavan',
      durationSeconds: 312,
      thumbnailUrl: 'https://i.ytimg.com/vi/abcDEF_1234/hqdefault.jpg',
      sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234',
      provider: 'yt-dlp'
    },
    {
      id: 'xyzDEF_5678',
      title: 'Lilás',
      artist: 'Djavan',
      durationSeconds: 245,
      thumbnailUrl: 'https://i.ytimg.com/vi/xyzDEF_5678/default.jpg',
      sourceUrl: 'https://www.youtube.com/watch?v=xyzDEF_5678',
      provider: 'yt-dlp'
    }
  ]);

  assert.equal(fixture.requests.length, 1);
  const request = fixture.requests[0];
  assert.equal(request.commandPath, '/usr/local/bin/yt-dlp');
  assert.equal(request.proxyUrl, 'http://127.0.0.1:45678');
  assert.ok(request.args.includes('--flat-playlist'));
  assert.ok(request.args.includes('--dump-single-json'));
  assert.ok(request.args.includes('--skip-download'));
  assert.equal(request.args[request.args.indexOf('--playlist-end') + 1], '3');
  assert.equal(request.args[request.args.indexOf('--proxy') + 1], 'http://127.0.0.1:45678');
  assert.equal(request.args.at(-1), 'ytsearch3:Djavan Samurai');
  assert.equal(request.args.includes('--output'), false);
  assert.equal(request.args.includes('--format'), false);
  assert.equal(fixture.proxyClosed(), true);
});

test('descarta ids inseguros, duplicatas e thumbnails fora dos hosts permitidos', async () => {
  const fixture = searchWith({
    _type: 'playlist',
    entries: [
      { id: '../escape', title: 'Malicioso' },
      { id: 'safeID_12345', title: 'Faixa', uploader: 'Canal', thumbnail: 'http://127.0.0.1/private.jpg' },
      { id: 'safeID_12345', title: 'Duplicada', uploader: 'Canal' }
    ]
  });

  const result = await fixture.search.search('Faixa', new AbortController().signal);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'safeID_12345');
  assert.equal(result.items[0].thumbnailUrl, null);
  assert.equal(JSON.stringify(result).includes('127.0.0.1'), false);
});

test('valida termo antes de executar o provider', async () => {
  assert.throws(() => normalizeYtDlpSearchQuery(' '), /2 caracteres/);
  assert.throws(() => normalizeYtDlpSearchQuery('a'), /2 caracteres/);
  assert.equal(normalizeYtDlpSearchQuery('  música   artista '), 'música artista');

  const fixture = searchWith({ _type: 'playlist', entries: [] });
  await assert.rejects(
    () => fixture.search.search('', new AbortController().signal),
    /2 caracteres/
  );
  assert.equal(fixture.requests.length, 0);
});
