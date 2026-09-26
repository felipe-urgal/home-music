import type { TrackRhythm } from '@home-music/shared';
import { hasUsableBarGrid, hasUsableBeatGrid } from './dj-beat-grid';

export type DjWaveformMarker = {
  position: number;
  kind: 'beat' | 'downbeat';
};

export function buildDjWaveformMarkers(
  rhythm: TrackRhythm | null | undefined,
  durationSeconds: number,
  maxMarkers = 4_096
): DjWaveformMarker[] {
  if (
    !rhythm
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || !hasUsableBeatGrid(rhythm)
    || !Number.isInteger(maxMarkers)
    || maxMarkers <= 0
  ) return [];

  const beatSeconds = 60 / rhythm.bpm;
  const hasDownbeat = hasUsableBarGrid(rhythm);

  const markers: DjWaveformMarker[] = [];
  const epsilon = beatSeconds * 0.15;
  for (
    let beatAt = rhythm.firstBeatSeconds;
    beatAt <= durationSeconds + 1e-9 && markers.length < maxMarkers;
    beatAt += beatSeconds
  ) {
    let kind: DjWaveformMarker['kind'] = 'beat';
    if (hasDownbeat) {
      const barSeconds = beatSeconds * rhythm.beatsPerBar!;
      const offset = beatAt - rhythm.downbeatSeconds!;
      const nearestBar = Math.round(offset / barSeconds);
      const expected = rhythm.downbeatSeconds! + (nearestBar * barSeconds);
      if (Math.abs(beatAt - expected) <= epsilon) kind = 'downbeat';
    }
    markers.push({
      position: Math.max(0, Math.min(1, beatAt / durationSeconds)),
      kind
    });
  }
  return markers;
}
