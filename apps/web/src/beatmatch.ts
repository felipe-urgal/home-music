import type { TrackRhythm } from '@home-music/shared';
import { MIN_RHYTHM_CONFIDENCE } from './beat-clock';

export const MAX_BEATMATCH_RATE_DELTA = 0.04;
export const MAX_BEATMATCH_PHASE_LEAD_SECONDS = 0.75;
export const BEATMATCH_RATE_RESTORE_SECONDS = 4;

export type BeatmatchPlan = {
  playbackRate: number;
  tempoFactor: 0.5 | 1 | 2;
  phaseLeadSeconds: number;
};

function validRhythm(rhythm: TrackRhythm | null | undefined): rhythm is TrackRhythm {
  return Boolean(
    rhythm
    && Number.isFinite(rhythm.bpm)
    && rhythm.bpm > 0
    && Number.isFinite(rhythm.firstBeatSeconds)
    && rhythm.firstBeatSeconds >= 0
    && Number.isFinite(rhythm.confidence)
    && rhythm.confidence >= MIN_RHYTHM_CONFIDENCE
  );
}

export function resolveBeatmatchPlan(options: {
  outgoing: TrackRhythm | null | undefined;
  incoming: TrackRhythm | null | undefined;
  maxRateDelta?: number;
}): BeatmatchPlan | null {
  const { outgoing, incoming } = options;
  const maxRateDelta = options.maxRateDelta ?? MAX_BEATMATCH_RATE_DELTA;
  if (
    !validRhythm(outgoing)
    || !validRhythm(incoming)
    || !Number.isFinite(maxRateDelta)
    || maxRateDelta < 0
  ) return null;

  const factors = [1, 2, 0.5] as const;
  let best: { factor: 0.5 | 1 | 2; rate: number; distance: number } | null = null;

  for (const factor of factors) {
    const effectiveIncomingBpm = incoming.bpm * factor;
    const rate = outgoing.bpm / effectiveIncomingBpm;
    const distance = Math.abs(rate - 1);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (!best || distance < best.distance) best = { factor, rate, distance };
  }

  if (!best || best.distance > maxRateDelta) return null;

  const playbackRate = Number(best.rate.toFixed(6));
  return {
    playbackRate,
    tempoFactor: best.factor,
    phaseLeadSeconds: Number((incoming.firstBeatSeconds / playbackRate).toFixed(6))
  };
}

export function canPhaseAlignBeatmatch(
  plan: BeatmatchPlan | null,
  maxPhaseLeadSeconds = MAX_BEATMATCH_PHASE_LEAD_SECONDS
) {
  return Boolean(
    plan
    && Number.isFinite(maxPhaseLeadSeconds)
    && maxPhaseLeadSeconds >= 0
    && plan.phaseLeadSeconds <= maxPhaseLeadSeconds
  );
}

export function interpolatePlaybackRate(
  initialRate: number,
  elapsedSeconds: number,
  durationSeconds = BEATMATCH_RATE_RESTORE_SECONDS
) {
  if (!Number.isFinite(initialRate) || initialRate <= 0) return 1;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return initialRate;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;

  const progress = Math.max(0, Math.min(1, elapsedSeconds / durationSeconds));
  return initialRate + ((1 - initialRate) * progress);
}
