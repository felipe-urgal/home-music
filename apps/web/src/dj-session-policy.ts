import type { CrossfadeDeck } from './crossfade';

export type NormalPlaybackSessionSnapshot = {
  trackId: string | null;
  positionSeconds: number;
  wasPlaying: boolean;
  activeDeck: CrossfadeDeck;
};

export function createNormalPlaybackSessionSnapshot(input: {
  trackId: string | null;
  currentTimeSeconds: number;
  playing: boolean;
  activeDeck: CrossfadeDeck;
}): NormalPlaybackSessionSnapshot {
  return {
    trackId: input.trackId,
    positionSeconds: Number.isFinite(input.currentTimeSeconds)
      ? Math.max(0, input.currentTimeSeconds)
      : 0,
    wasPlaying: input.playing,
    activeDeck: input.activeDeck
  };
}
