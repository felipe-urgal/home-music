import type { TrackRhythm } from '@home-music/shared';
import { nearestBeatAt } from './dj-beat-grid';

export function resolveHotCuePosition(options: {
  positionSeconds: number;
  durationSeconds: number | null | undefined;
  rhythm: TrackRhythm | null | undefined;
  quantize: boolean;
}) {
  const rawPosition = Number.isFinite(options.positionSeconds)
    ? Math.max(0, options.positionSeconds)
    : 0;
  const boundedPosition = options.durationSeconds != null
    && Number.isFinite(options.durationSeconds)
    && options.durationSeconds >= 0
    ? Math.min(rawPosition, options.durationSeconds)
    : rawPosition;

  if (!options.quantize) return boundedPosition;

  const quantized = nearestBeatAt(options.rhythm, boundedPosition);
  if (quantized == null) return boundedPosition;

  return options.durationSeconds != null
    && Number.isFinite(options.durationSeconds)
    && options.durationSeconds >= 0
    ? Math.min(quantized, options.durationSeconds)
    : quantized;
}
