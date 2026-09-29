import assert from 'node:assert/strict';
import test from 'node:test';
import { djKeyCompatibility, djKeyFromPitchClass } from '@home-music/shared';
import { analyzePcmKey, KEY_ANALYSIS_SAMPLE_RATE } from './key-analysis.js';

function chordTrack(midis: number[], durationSeconds = 6, sampleRate = KEY_ANALYSIS_SAMPLE_RATE) {
  const samples = new Int16Array(Math.round(durationSeconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (const midi of midis) {
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      value += Math.sin(2 * Math.PI * frequency * time);
    }
    samples[index] = Math.round((value / Math.max(1, midis.length)) * 22_000);
  }
  return samples;
}

test('detecta acordes tonais sintéticos major e minor', () => {
  const cMajor = analyzePcmKey(chordTrack([60, 64, 67]));
  assert.ok(cMajor);
  assert.equal(cMajor.tonic, 'C');
  assert.equal(cMajor.mode, 'major');
  assert.equal(cMajor.camelot, '8B');
  assert.ok(cMajor.confidence > 0);

  const aMinor = analyzePcmKey(chordTrack([57, 60, 64]));
  assert.ok(aMinor);
  assert.equal(aMinor.tonic, 'A');
  assert.equal(aMinor.mode, 'minor');
  assert.equal(aMinor.camelot, '8A');
  assert.ok(aMinor.confidence > 0);
});

test('silêncio e áudio curto não viram tonalidade falsa', () => {
  assert.equal(
    analyzePcmKey(new Int16Array(KEY_ANALYSIS_SAMPLE_RATE * 6)),
    null
  );
  assert.equal(
    analyzePcmKey(chordTrack([60, 64, 67], 2)),
    null
  );
});

test('compatibilidade harmônica é pura e tolera dados ausentes', () => {
  const cMajor = djKeyFromPitchClass(0, 'major', 0.9);
  const aMinor = djKeyFromPitchClass(9, 'minor', 0.9);
  const gMajor = djKeyFromPitchClass(7, 'major', 0.9);
  const fsMajor = djKeyFromPitchClass(6, 'major', 0.9);

  assert.deepEqual(djKeyCompatibility(cMajor, cMajor), {
    compatible: true,
    score: 1,
    relation: 'same-key'
  });
  assert.equal(djKeyCompatibility(cMajor, aMinor).relation, 'relative-major-minor');
  assert.equal(djKeyCompatibility(cMajor, gMajor).relation, 'adjacent-camelot');
  assert.equal(djKeyCompatibility(cMajor, fsMajor).compatible, false);
  assert.equal(djKeyCompatibility(cMajor, null).relation, 'unknown');
});
