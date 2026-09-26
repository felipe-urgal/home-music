import { describe, expect, it } from 'vitest';
import { buildDjWaveformMarkers } from './dj-waveform-grid';

describe('DJ waveform beat grid', () => {
  it('gera beats e destaca downbeats confiáveis', () => {
    const markers = buildDjWaveformMarkers({
      bpm: 120,
      firstBeatSeconds: 0,
      confidence: 0.95,
      downbeatSeconds: 0,
      beatsPerBar: 4,
      downbeatConfidence: 0.95
    }, 4);

    expect(markers.length).toBe(9);
    expect(markers[0]).toEqual({ position: 0, kind: 'downbeat' });
    expect(markers[1]?.kind).toBe('beat');
    expect(markers[4]?.kind).toBe('downbeat');
    expect(markers[8]?.kind).toBe('downbeat');
  });

  it('degrada para beats quando downbeat não é confiável', () => {
    const markers = buildDjWaveformMarkers({
      bpm: 120,
      firstBeatSeconds: 0.5,
      confidence: 0.9,
      downbeatSeconds: 0.5,
      beatsPerBar: 4,
      downbeatConfidence: 0.1
    }, 2);

    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every(marker => marker.kind === 'beat')).toBe(true);
  });

  it('desenha espaçamento diferente depois da troca de segmento', () => {
    const markers = buildDjWaveformMarkers({
      bpm: 120,
      firstBeatSeconds: 0,
      confidence: 0.95,
      beatGrid: {
        version: 1,
        segments: [
          { startSeconds: 0, bpm: 120, firstBeatSeconds: 0, confidence: 0.95 },
          { startSeconds: 2, bpm: 60, firstBeatSeconds: 2, confidence: 0.95 }
        ]
      }
    }, 4);

    const seconds = markers.map(marker => marker.position * 4);
    expect(seconds.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
    expect(seconds.slice(4)).toEqual([2, 3]);
    expect(markers.every(marker => marker.kind === 'beat')).toBe(true);
  });

  it('não inventa grid para análise de baixa confiança', () => {
    expect(buildDjWaveformMarkers({
      bpm: 128,
      firstBeatSeconds: 0,
      confidence: 0.1
    }, 180)).toEqual([]);
  });
});
