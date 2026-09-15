import type { RepeatMode } from './index.js';

export type TvRemoteCommand =
  | { type: 'set-crossfade'; seconds: number }
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; deltaSeconds: -10 | 10 }
  | { type: 'toggle-shuffle' }
  | { type: 'cycle-repeat' }
  | { type: 'play-track'; trackId: string };

export type TvRemotePlaybackSnapshot = {
  trackId: string | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  updatedAt: string;
  crossfadeSeconds?: number;
  lastAppliedCrossfadeCommandId?: number;
  shuffle?: boolean;
  repeatMode?: RepeatMode;
};

export type TvRemoteSessionSummary = {
  capabilities?: {
    crossfadeControl: true;
  };
  id: string;
  expiresAt: string;
  snapshot: TvRemotePlaybackSnapshot | null;
};

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'remote-connected'; data: Record<string, never> }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };

export const TV_REMOTE_CROSSFADE_MAX_SECONDS = 30;

export function isTvRemoteCrossfadeSeconds(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= TV_REMOTE_CROSSFADE_MAX_SECONDS;
}

export function hasTvRemoteCrossfadePair<T extends Record<string, unknown>>(
  value: T
): value is T & { crossfadeSeconds: number; lastAppliedCrossfadeCommandId: number } {
  return isTvRemoteCrossfadeSeconds(value.crossfadeSeconds)
    && typeof value.lastAppliedCrossfadeCommandId === 'number'
    && Number.isSafeInteger(value.lastAppliedCrossfadeCommandId);
}
