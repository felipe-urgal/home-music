import type {
  TvRemoteCommand as LegacyTvRemoteCommand,
  TvRemotePlaybackSnapshot
} from './index.js';

export type TvRemoteCommand =
  | LegacyTvRemoteCommand
  | { type: 'play-track'; trackId: string };

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };
