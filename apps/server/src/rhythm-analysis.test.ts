import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzePcmRhythm,
  isFfmpegDecodeFailure,
  RHYTHM_ANALYSIS_SAMPLE_RATE
} from './rhythm-analysis.js';

function pulseTrack(
  bpm: number,
  firstBeatSeconds: number,
  durationSeconds = 24,
  sampleRate = RHYTHM_ANALYSIS_SAMPLE_RATE,
  beatsPerBar?: 3 | 4
) {
  const samples = new Int16Array(Math.round(durationSeconds * sampleRate));
  const period = 60 / bpm;
  const pulseSamples = Math.max(1, Math.round(sampleRate * 0.03));
  let beatIndex = 0;

  for (let beat = firstBeatSeconds; beat < durationSeconds; beat += period) {
    const start = Math.round(beat * sampleRate);
    const peakAmplitude = beatsPerBar
      ? (beatIndex % beatsPerBar === 0 ? 28_000 : 18_000)
      : 28_000;
    for (let offset = 0; offset < pulseSamples && start + offset < samples.length; offset += 1) {
      const amplitude = Math.round(peakAmplitude * Math.exp(-offset / (sampleRate * 0.006)));
      if (amplitude > samples[start + offset]) samples[start + offset] = amplitude;
    }
    beatIndex += 1;
  }

  return samples;
}

function driftingPulseTrack(
  startBpm: number,
  endBpm: number,
  durationSeconds = 120,
  sampleRate = RHYTHM_ANALYSIS_SAMPLE_RATE
) {
  const samples = new Int16Array(Math.round(durationSeconds * sampleRate));
  const pulseSamples = Math.max(1, Math.round(sampleRate * 0.03));
  let beatAt = 0.3;

  while (beatAt < durationSeconds) {
    const progress = Math.max(0, Math.min(1, beatAt / durationSeconds));
    const bpm = startBpm + ((endBpm - startBpm) * progress);
    const start = Math.round(beatAt * sampleRate);
    for (let offset = 0; offset < pulseSamples && start + offset < samples.length; offset += 1) {
      const amplitude = Math.round(28_000 * Math.exp(-offset / (sampleRate * 0.006)));
      if (amplitude > samples[start + offset]) samples[start + offset] = amplitude;
    }
    beatAt += 60 / bpm;
  }

  return samples;
}

for (const bpm of [60, 90, 120, 128, 140, 150, 174]) {
  test(`detecta BPM estável próximo de ${bpm}`, () => {
    const result = analyzePcmRhythm(pulseTrack(bpm, 0.3));
    assert.ok(result);
    assert.ok(Math.abs(result.bpm - bpm) <= 1, `BPM detectado: ${result.bpm}`);
    assert.ok(
      Math.abs(result.firstBeatSeconds - 0.3) <= 0.04,
      `Primeira batida detectada: ${result.firstBeatSeconds}`
    );
    assert.ok(result.confidence >= 0.5);
  });
}

test('respeita offset diferente de zero na primeira batida', () => {
  const result = analyzePcmRhythm(pulseTrack(128, 1.17));
  assert.ok(result);
  assert.ok(Math.abs(result.firstBeatSeconds - 1.17) <= 0.04);
});

test('preserva fase quando existe intro longa sem bateria', () => {
  const result = analyzePcmRhythm(pulseTrack(128, 6.2, 24));
  assert.ok(result);
  assert.ok(Math.abs(result.bpm - 128) <= 1, `BPM detectado: ${result.bpm}`);
  assert.ok(
    Math.abs(result.firstBeatSeconds - 6.2) <= 0.04,
    `Primeira batida detectada: ${result.firstBeatSeconds}`
  );
});


test('detecta downbeat 4/4 quando há acentuação periódica suficiente', () => {
  const result = analyzePcmRhythm(
    pulseTrack(120, 0.37, 24, RHYTHM_ANALYSIS_SAMPLE_RATE, 4)
  );
  assert.ok(result);
  assert.equal(result.beatsPerBar, 4);
  assert.ok(Math.abs((result.downbeatSeconds ?? -1) - 0.37) <= 0.04);
  assert.ok((result.downbeatConfidence ?? 0) >= 0.6);
});

test('detecta compasso 3/4 sem presumir 4/4', () => {
  const result = analyzePcmRhythm(
    pulseTrack(120, 0.41, 24, RHYTHM_ANALYSIS_SAMPLE_RATE, 3)
  );
  assert.ok(result);
  assert.equal(result.beatsPerBar, 3);
  assert.ok(Math.abs((result.downbeatSeconds ?? -1) - 0.41) <= 0.04);
  assert.ok((result.downbeatConfidence ?? 0) >= 0.6);
});

test('não promove compasso quando os beats têm acentuação uniforme', () => {
  const result = analyzePcmRhythm(pulseTrack(120, 0.3));
  assert.ok(result);
  assert.equal(result.downbeatSeconds, undefined);
  assert.equal(result.beatsPerBar, undefined);
  assert.equal(result.downbeatConfidence, undefined);
});

test('promove drift gradual conhecido para beat grid variável', () => {
  const result = analyzePcmRhythm(driftingPulseTrack(116, 124));
  assert.ok(result);
  assert.ok(result.beatGrid);
  assert.ok(result.beatGrid.segments.length >= 2);
  const first = result.beatGrid.segments[0]?.bpm ?? 0;
  const last = result.beatGrid.segments.at(-1)?.bpm ?? 0;
  assert.ok(last > first, `grid variável esperado crescente: ${first} -> ${last}`);
});

test('silêncio não produz análise rítmica falsa', () => {
  const samples = new Int16Array(RHYTHM_ANALYSIS_SAMPLE_RATE * 12);
  assert.equal(analyzePcmRhythm(samples), null);
});

test('áudio muito curto não é analisado', () => {
  const samples = pulseTrack(120, 0.2, 2);
  assert.equal(analyzePcmRhythm(samples), null);
});


test('classifica somente stderr compatível com falha determinística de decode', () => {
  assert.equal(
    isFfmpegDecodeFailure(
      '[dec:aac] Error submitting packet to decoder: Invalid data found when processing input'
    ),
    true
  );
  assert.equal(
    isFfmpegDecodeFailure('Error while decoding stream #0:0: Invalid data found when processing input'),
    true
  );
  assert.equal(isFfmpegDecodeFailure('Packet corrupt (stream = 0, dts = 123).'), true);

  assert.equal(isFfmpegDecodeFailure('/music/faixa.mp3: Permission denied'), false);
  assert.equal(isFfmpegDecodeFailure('/music/faixa.mp3: No such file or directory'), false);
  assert.equal(isFfmpegDecodeFailure('Cannot allocate memory'), false);
  assert.equal(isFfmpegDecodeFailure('Decoder not found'), false);
});
