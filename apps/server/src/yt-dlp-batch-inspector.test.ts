import assert from 'node:assert/strict';
import test from 'node:test';
import type { YtDlpProcessRequest } from './yt-dlp-provider.js';
import { YtDlpBatchInspector } from './yt-dlp-batch-inspector.js';

function inspectorWith(payload: unknown) {
  const requests: YtDlpProcessRequest[] = [];
  let proxyClosed = false;
  const inspector = new YtDlpBatchInspector({
    commandPath: '/usr/local/bin/yt-dlp',
    maxItems: 3,
    runner: async request => {
      requests.push(request);
      return { stdout: JSON.stringify(payload), stderr: '' };
    },
    createProxy: async () => ({
      url: 'http://127.0.0.1:45678',
      close: async () => { proxyClosed = true; }
    })
  });
  return { inspector, requests, proxyClosed: () => proxyClosed };
}

test('inspeciona playlist com proxy, runtime Node e limite maxItems + 1', async () => {
  const item = inspectorWith({
    _type: 'playlist',
    id: 'PL123',
    title: 'Minha Playlist',
    entries: [
      { id: 'abcDEF_1234', title: 'Faixa 1', duration: 120 },
      { id: 'xyzDEF_5678', title: 'Faixa 2', duration: '180' }
    ]
  });

  const result = await item.inspector.inspect(
    { url: 'https://music.youtube.com/playlist?list=PL123#trecho' },
    new AbortController().signal
  );
  assert.ok(result);
  assert.equal(result.label, 'Minha Playlist');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].request?.url, 'https://music.youtube.com/watch?v=abcDEF_1234');
  assert.equal(result.items[1].durationSeconds, 180);
  assert.equal(item.requests.length, 1);
  const args = item.requests[0].args;
  assert.ok(args.includes('--yes-playlist'));
  assert.ok(args.includes('--flat-playlist'));
  assert.ok(args.includes('--skip-download'));
  assert.equal(args.includes('--no-playlist'), false);
  assert.equal(args[args.indexOf('--playlist-end') + 1], '4');
  assert.ok(args.some(value => value.startsWith('node:')));
  assert.equal(args[args.indexOf('--proxy') + 1], 'http://127.0.0.1:45678');
  assert.equal(args.at(-1), 'https://music.youtube.com/playlist?list=PL123');
  assert.equal(item.proxyClosed(), true);
});

test('não confia em URL retornada pelo provider e ignora item sem id seguro', async () => {
  const item = inspectorWith({
    _type: 'playlist',
    title: 'Lista',
    entries: [
      { id: '../escape', title: 'Malicioso', url: 'http://127.0.0.1/private' },
      { id: 'safeID_12345', title: 'Seguro', url: 'http://127.0.0.1/private' }
    ]
  });
  const result = await item.inspector.inspect(
    { url: 'https://www.youtube.com/playlist?list=PL123' },
    new AbortController().signal
  );
  assert.ok(result);
  assert.equal(result.items[0].request, null);
  assert.match(result.items[0].unavailableReason ?? '', /identificador seguro/);
  assert.equal(result.items[1].request?.url, 'https://www.youtube.com/watch?v=safeID_12345');
  assert.equal(JSON.stringify(result).includes('127.0.0.1'), false);
});

test('link individual sem parâmetro list não é tratado como lote', async () => {
  const item = inspectorWith({ _type: 'playlist', entries: [] });
  const result = await item.inspector.inspect(
    { url: 'https://www.youtube.com/watch?v=abcDEF_1234' },
    new AbortController().signal
  );
  assert.equal(result, null);
  assert.equal(item.requests.length, 0);
});

test('link watch com contexto de Mix continua sendo uma faixa individual', async () => {
  const item = inspectorWith({ _type: 'playlist', entries: [{ id: 'other123' }] });
  const result = await item.inspector.inspect(
    { url: 'https://www.youtube.com/watch?v=oDdtJfBTfVw&list=RD4cxSmgHV_eQ&index=13' },
    new AbortController().signal
  );
  assert.equal(result, null);
  assert.equal(item.requests.length, 0);
});

test('host fora do YouTube não é enviado ao inspector de playlist', async () => {
  const item = inspectorWith({ _type: 'playlist', entries: [] });
  const result = await item.inspector.inspect(
    { url: 'https://example.com/playlist?list=PL123' },
    new AbortController().signal
  );
  assert.equal(result, null);
  assert.equal(item.requests.length, 0);
});

test('resultado não-playlist permite fallback para importação individual', async () => {
  const item = inspectorWith({ _type: 'video', id: 'abcDEF_1234', title: 'Faixa' });
  const result = await item.inspector.inspect(
    { url: 'https://www.youtube.com/playlist?list=PL123' },
    new AbortController().signal
  );
  assert.equal(result, null);
  assert.equal(item.requests.length, 1);
});
