import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTvRemoteCommand } from './tv-remote-command.js';

test('parseTvRemoteCommand accepts play-track with a normalized track id', () => {
  assert.deepEqual(parseTvRemoteCommand({ type: 'play-track', trackId: '  track-42  ' }), {
    type: 'play-track',
    trackId: 'track-42'
  });
});

test('parseTvRemoteCommand rejects malformed play-track payloads', () => {
  for (const payload of [
    { type: 'play-track' },
    { type: 'play-track', trackId: '' },
    { type: 'play-track', trackId: '   ' },
    { type: 'play-track', trackId: 42 },
    { type: 'play-track', trackId: 'track-1', extra: true }
  ]) {
    assert.equal(parseTvRemoteCommand(payload), null);
  }
});

test('parseTvRemoteCommand keeps the existing remote controls strict', () => {
  assert.deepEqual(parseTvRemoteCommand({ type: 'toggle-play' }), { type: 'toggle-play' });
  assert.deepEqual(parseTvRemoteCommand({ type: 'previous' }), { type: 'previous' });
  assert.deepEqual(parseTvRemoteCommand({ type: 'next' }), { type: 'next' });
  assert.deepEqual(parseTvRemoteCommand({ type: 'seek', deltaSeconds: -10 }), { type: 'seek', deltaSeconds: -10 });
  assert.deepEqual(parseTvRemoteCommand({ type: 'seek', deltaSeconds: 10 }), { type: 'seek', deltaSeconds: 10 });
  assert.equal(parseTvRemoteCommand({ type: 'next', extra: true }), null);
  assert.equal(parseTvRemoteCommand({ type: 'seek', deltaSeconds: 11 }), null);
});
