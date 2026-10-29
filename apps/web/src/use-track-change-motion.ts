import { useState } from 'react';

/**
 * 'init' = primeira montagem; 'a'/'b' alternam a cada troca manual de faixa para reiniciar a animação CSS;
 * 'none' = a troca veio do crossfade, que já animou a entrada pelo progresso do áudio.
 */
export type TrackChangeMotionKind = 'init' | 'a' | 'b' | 'none';

type MotionState = {
  trackId: string;
  seq: number;
  kind: TrackChangeMotionKind;
  lastIncomingId: string | null;
};

export function useTrackChangeMotion(trackId: string, incomingTrackId: string | null): TrackChangeMotionKind {
  const [motion, setMotion] = useState<MotionState>({ trackId, seq: 0, kind: 'init', lastIncomingId: null });

  let next = motion;
  if (incomingTrackId && incomingTrackId !== next.lastIncomingId) {
    next = { ...next, lastIncomingId: incomingTrackId };
  }
  if (next.trackId !== trackId) {
    const seq = next.seq + 1;
    next = { ...next, trackId, seq, kind: next.lastIncomingId === trackId ? 'none' : seq % 2 ? 'a' : 'b' };
  }
  if (next !== motion) setMotion(next);

  return next.kind;
}
