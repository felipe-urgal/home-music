export const DJ_KEY_ANALYSIS_VERSION = 1 as const;

export type DjKeyMode = 'major' | 'minor';
export type DjKeyTonic =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type TrackMusicalKey = {
  version: typeof DJ_KEY_ANALYSIS_VERSION;
  tonic: DjKeyTonic;
  mode: DjKeyMode;
  notation: string;
  camelot: string;
  confidence: number;
};

const TONICS: DjKeyTonic[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F',
  'F#', 'G', 'G#', 'A', 'A#', 'B'
];

const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

export function djKeyFromPitchClass(
  pitchClass: number,
  mode: DjKeyMode,
  confidence: number
): TrackMusicalKey {
  const normalized = ((Math.round(pitchClass) % 12) + 12) % 12;
  const tonic = TONICS[normalized]!;
  const safeConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence))
    : 0;
  return {
    version: DJ_KEY_ANALYSIS_VERSION,
    tonic,
    mode,
    notation: `${tonic} ${mode === 'major' ? 'Maj' : 'Min'}`,
    camelot: (mode === 'major' ? CAMELOT_MAJOR : CAMELOT_MINOR)[normalized]!,
    confidence: Number(safeConfidence.toFixed(4))
  };
}

function camelotParts(value: string) {
  const match = /^(1[0-2]|[1-9])([AB])$/.exec(value);
  if (!match) return null;
  return { number: Number(match[1]), side: match[2] as 'A' | 'B' };
}

function circularDistance(a: number, b: number) {
  const direct = Math.abs(a - b);
  return Math.min(direct, 12 - direct);
}

export function djKeyCompatibility(
  left: TrackMusicalKey | null | undefined,
  right: TrackMusicalKey | null | undefined
) {
  if (!left || !right) {
    return { compatible: false, score: 0, relation: 'unknown' as const };
  }

  const a = camelotParts(left.camelot);
  const b = camelotParts(right.camelot);
  if (!a || !b) {
    return { compatible: false, score: 0, relation: 'unknown' as const };
  }

  if (a.number === b.number && a.side === b.side) {
    return { compatible: true, score: 1, relation: 'same-key' as const };
  }

  if (a.number === b.number && a.side !== b.side) {
    return { compatible: true, score: 0.92, relation: 'relative-major-minor' as const };
  }

  if (a.side === b.side && circularDistance(a.number, b.number) === 1) {
    return { compatible: true, score: 0.86, relation: 'adjacent-camelot' as const };
  }

  return { compatible: false, score: 0.2, relation: 'distant' as const };
}
