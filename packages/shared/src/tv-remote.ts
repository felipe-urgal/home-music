import type { TvRemotePlaybackSnapshot } from './index.js';

export type TvRemoteCommand =
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; deltaSeconds: -10 | 10 }
  | { type: 'play-track'; trackId: string };

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };
