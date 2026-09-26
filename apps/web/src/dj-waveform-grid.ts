import {
  MIN_DOWNBEAT_CONFIDENCE,
  MIN_RHYTHM_CONFIDENCE,
  type TrackRhythm
} from '@home-music/shared';

export type DjWaveformMarker = {
  position: number;
  kind: 'beat' | 'downbeat';
};

export function buildDjWaveformMarkers(
  rhythm: TrackRhythm | null | undefined,
  durationSeconds: number,
  maxMarkers = 512
): DjWaveformMarker[] {
  if (
    !rhythm
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || !Number.isFinite(rhythm.bpm)
    || rhythm.bpm <= 0
    || !Number.isFinite(rhythm.firstBeatSeconds)
    || rhythm.firstBeatSeconds < 0
    || !Number.isFinite(rhythm.confidence)
    || rhythm.confidence < MIN_RHYTHM_CONFIDENCE
    || !Number.isInteger(maxMarkers)
    || maxMarkers <= 0
  ) return [];

  const beatSeconds = 60 / rhythm.bpm;
  const hasDownbeat = (
    typeof rhythm.downbeatSeconds === 'number'
    && Number.isFinite(rhythm.downbeatSeconds)
    && rhythm.downbeatSeconds >= 0
    && (rhythm.beatsPerBar === 3 || rhythm.beatsPerBar === 4)
    && typeof rhythm.downbeatConfidence === 'number'
    && Number.isFinite(rhythm.downbeatConfidence)
    && rhythm.downbeatConfidence >= MIN_DOWNBEAT_CONFIDENCE
  );

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
