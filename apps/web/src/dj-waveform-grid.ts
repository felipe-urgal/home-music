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

  const variableSegments = rhythm.beatGrid?.segments ?? [];
  if (variableSegments.length) {
    const markers: DjWaveformMarker[] = [];
    for (let segmentIndex = 0; segmentIndex < variableSegments.length; segmentIndex += 1) {
      const segment = variableSegments[segmentIndex]!;
      const endSeconds = variableSegments[segmentIndex + 1]?.startSeconds ?? durationSeconds;
      const beatSeconds = 60 / segment.bpm;
      if (!Number.isFinite(beatSeconds) || beatSeconds <= 0) continue;

      let beatAt = segment.firstBeatSeconds;
      if (beatAt < segment.startSeconds) {
        const jumps = Math.ceil((segment.startSeconds - beatAt) / beatSeconds);
        beatAt += jumps * beatSeconds;
      }

      for (
        ;
        beatAt < endSeconds - 1e-9
          && beatAt <= durationSeconds + 1e-9
          && markers.length < maxMarkers;
        beatAt += beatSeconds
      ) {
        markers.push({
          position: Math.max(0, Math.min(1, beatAt / durationSeconds)),
          kind: 'beat'
        });
      }
      if (markers.length >= maxMarkers) break;
    }
    return markers;
  }

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
