import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetryingFetch } from './retrying-fetch.js';

test('retrying fetch recupera 503 transitório antes de devolver resposta ao analyzer', async () => {
  let calls = 0;
  const delays: number[] = [];
  const fetchImpl = createRetryingFetch(async () => {
    calls += 1;
    return calls === 1
      ? new Response('busy', { status: 503 })
      : new Response('{"recordings":[]}', { status: 200 });
  }, {
    retryDelaysMs: [25, 50],
    sleep: async delayMs => { delays.push(delayMs); }
  });

  const response = await fetchImpl('https://musicbrainz.org/ws/2/recording');

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [25]);
});

test('retrying fetch respeita Retry-After com teto e encerra após o orçamento configurado', async () => {
  let calls = 0;
  const delays: number[] = [];
  const fetchImpl = createRetryingFetch(async () => {
    calls += 1;
    return new Response('rate limited', {
      status: 429,
      headers: { 'retry-after': '10' }
    });
  }, {
    retryDelaysMs: [10, 20],
    maxRetryAfterMs: 80,
    sleep: async delayMs => { delays.push(delayMs); }
  });

  const response = await fetchImpl('https://musicbrainz.org/ws/2/recording');

  assert.equal(response.status, 429);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [80, 80]);
});

test('retrying fetch não repete falha definitiva', async () => {
  let calls = 0;
  const fetchImpl = createRetryingFetch(async () => {
    calls += 1;
    return new Response('bad request', { status: 400 });
  }, {
    retryDelaysMs: [0, 0],
    sleep: async () => undefined
  });

  const response = await fetchImpl('https://musicbrainz.org/ws/2/recording');

  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});
