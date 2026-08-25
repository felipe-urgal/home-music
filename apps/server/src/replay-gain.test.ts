import assert from 'node:assert/strict';
import test from 'node:test';
import { clampReplayGainDb, replayGainDb, replayGainForMode } from './replay-gain.js';

test('replayGainDb aceita formatos do music-metadata e strings dB', () => {
  assert.equal(replayGainDb({ dB: -7.25, ratio: 0.43 }), -7.25);
  assert.equal(replayGainDb('-5.50 dB'), -5.5);
  assert.ok(Math.abs((replayGainDb({ ratio: 0.5 }) ?? 0) - -6.0206) < 0.001);
  assert.equal(replayGainDb(undefined), null);
  assert.equal(replayGainDb('inválido'), null);
});

test('ReplayGain é limitado contra ganho excessivo', () => {
  assert.equal(clampReplayGainDb(-40), -24);
  assert.equal(clampReplayGainDb(30), 12);
  assert.equal(replayGainDb('+18 dB'), 12);
});

test('modo álbum usa ganho da faixa somente quando necessário', () => {
  assert.equal(replayGainForMode({ replayGainTrackDb: -7, replayGainAlbumDb: -5 }, 'album'), -5);
  assert.equal(replayGainForMode({ replayGainTrackDb: -7, replayGainAlbumDb: null }, 'album'), -7);
  assert.equal(replayGainForMode({ replayGainTrackDb: null, replayGainAlbumDb: -5 }, 'track'), null);
  assert.equal(replayGainForMode({ replayGainTrackDb: -40, replayGainAlbumDb: null }, 'track'), -24);
});
