import type {
  AdminLibraryDuplicateConfidence,
  AdminLibraryDuplicateReason
} from '@home-music/shared';

export type DuplicateHeuristicConfidence = Exclude<AdminLibraryDuplicateConfidence, 'exact'> | 'none';

export type DuplicateSignals = Readonly<{
  title: boolean;
  artist: boolean;
  album: boolean;
  duration: boolean;
  filename: boolean;
}>;

export function normalizeDuplicateText(value: string | null | undefined) {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function duplicateTextMatches(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const a = normalizeDuplicateText(left);
  const b = normalizeDuplicateText(right);
  return Boolean(a && b && a === b);
}

export function duplicateDurationMatches(
  left: number | null | undefined,
  right: number | null | undefined
) {
  if (
    left == null
    || right == null
    || !Number.isFinite(left)
    || !Number.isFinite(right)
    || left <= 0
    || right <= 0
  ) {
    return false;
  }
  const tolerance = Math.max(2, Math.max(left, right) * 0.02);
  return Math.abs(left - right) <= tolerance;
}

export function classifyDuplicateSignals(signals: DuplicateSignals): {
  confidence: DuplicateHeuristicConfidence;
  reasons: AdminLibraryDuplicateReason[];
} {
  const reasons: AdminLibraryDuplicateReason[] = [];
  if (signals.title) reasons.push('title');
  if (signals.artist) reasons.push('artist');
  if (signals.album) reasons.push('album');
  if (signals.duration) reasons.push('duration');
  if (signals.filename) reasons.push('filename');

  const probable =
    (signals.title && signals.artist && (signals.duration || signals.album))
    || (signals.filename && signals.artist && signals.duration);
  if (probable) return { confidence: 'probable', reasons };

  const possible =
    (signals.title && signals.artist)
    || (signals.title && signals.duration)
    || (signals.filename && signals.duration)
    || (signals.artist && signals.album && signals.duration);

  return possible
    ? { confidence: 'possible', reasons }
    : { confidence: 'none', reasons: [] };
}

export function duplicateConfidenceRank(confidence: AdminLibraryDuplicateConfidence | 'none') {
  switch (confidence) {
    case 'exact': return 3;
    case 'probable': return 2;
    case 'possible': return 1;
    case 'none': return 0;
  }
}
