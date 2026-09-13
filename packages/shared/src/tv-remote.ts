import type { RepeatMode } from './index.js';

export type TvRemoteCommand =
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
  shuffle?: boolean;
  repeatMode?: RepeatMode;
};

export type TvRemoteSessionSummary = {
  id: string;
  expiresAt: string;
  snapshot: TvRemotePlaybackSnapshot | null;
};

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'remote-connected'; data: Record<string, never> }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };
